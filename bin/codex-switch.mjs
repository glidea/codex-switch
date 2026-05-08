#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import readline from "node:readline/promises"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const codexDir = path.join(os.homedir(), ".codex")
const profilesDir = path.join(codexDir, "profiles")
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const bundledPresetsPath = path.join(scriptDir, "..", "presets.yaml")
const defaultPresetsUrl = "https://raw.githubusercontent.com/glidea/codex-switch/main/presets.yaml"
const defaultPresetsTtlMs = 5 * 60 * 1000

function fail(message) {
  console.error(message)
  process.exit(1)
}

function usage() {
  console.log(
    "usage: codex-switch <profile>|add <profile>|edit <profile>|rm <profile>|list|presets|current|completion [zsh|bash|fish|powershell] [--copy]"
  )
}

function help() {
  usage()
  console.log("")
  console.log("commands:")
  console.log("  codex-switch <profile>")
  console.log("  codex-switch <profile> --copy")
  console.log("  codex-switch add <profile>")
  console.log("  codex-switch add <profile> --preset <preset-id>")
  console.log("  codex-switch add <profile> --preset <preset-id> --apikey <key>")
  console.log("  codex-switch add <profile> --from-current")
  console.log("  codex-switch add <profile> --config <path> --auth <path>")
  console.log("  codex-switch edit <profile>")
  console.log("  codex-switch rm <profile>")
  console.log("  codex-switch list")
  console.log("  codex-switch presets")
  console.log("  codex-switch current")
  console.log("  codex-switch completion")
  console.log("  codex-switch completion <zsh|bash|fish|powershell>")
}

function profilePaths(profileName) {
  const dirPath = path.join(profilesDir, profileName)
  return {
    dirPath,
    configPath: path.join(dirPath, "config.toml"),
    authPath: path.join(dirPath, "auth.json")
  }
}

function ensureProfileExists(profileName) {
  const paths = profilePaths(profileName)
  if (!fs.existsSync(paths.configPath) || !fs.existsSync(paths.authPath)) {
    fail(`profile not found: ${profileName}`)
  }
  return paths
}

function switchProfile(profileName, useCopy) {
  const paths = ensureProfileExists(profileName)
  fs.mkdirSync(codexDir, { recursive: true })

  const rootConfigPath = path.join(codexDir, "config.toml")
  const rootAuthPath = path.join(codexDir, "auth.json")

  fs.rmSync(rootConfigPath, { force: true })
  fs.rmSync(rootAuthPath, { force: true })

  if (useCopy) {
    fs.copyFileSync(paths.configPath, rootConfigPath)
    fs.copyFileSync(paths.authPath, rootAuthPath)
  } else {
    fs.symlinkSync(paths.configPath, rootConfigPath, "file")
    fs.symlinkSync(paths.authPath, rootAuthPath, "file")
  }
}

function getCurrentProfileName() {
  const rootConfigPath = path.join(codexDir, "config.toml")
  if (!fs.existsSync(rootConfigPath)) {
    fail("current profile not found")
  }

  const stat = fs.lstatSync(rootConfigPath)
  if (!stat.isSymbolicLink()) {
    fail("current profile is not symlink")
  }

  const linkTarget = fs.readlinkSync(rootConfigPath)
  const fullTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(path.dirname(rootConfigPath), linkTarget)
  const parts = fullTarget.split(path.sep)
  const profilesIndex = parts.lastIndexOf("profiles")
  if (profilesIndex < 0 || profilesIndex + 1 >= parts.length) {
    fail("cannot parse current profile")
  }

  return parts[profilesIndex + 1]
}

function listProfiles() {
  if (!fs.existsSync(profilesDir)) {
    return
  }
  const names = fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (names.length > 0) {
    console.log(names.join("\n"))
  }
}

function parseAddOptions(addArgs) {
  let fromCurrent = false
  let presetId = ""
  let apiKey = ""
  let configSourcePath = ""
  let authSourcePath = ""

  for (let i = 0; i < addArgs.length; i += 1) {
    const token = addArgs[i]
    if (token === "--from-current") {
      fromCurrent = true
      continue
    }
    if (token === "--preset") {
      const value = addArgs[i + 1] || ""
      if (!value || value.startsWith("--")) {
        fail("--preset requires <preset-id>")
      }
      presetId = value
      i += 1
      continue
    }
    if (token === "--apikey" || token === "--apiKey") {
      const value = addArgs[i + 1] || ""
      if (!value || value.startsWith("--")) {
        fail("--apikey|--apiKey requires <key>")
      }
      apiKey = value
      i += 1
      continue
    }
    if (token === "--config") {
      configSourcePath = addArgs[i + 1] || ""
      i += 1
      continue
    }
    if (token === "--auth") {
      authSourcePath = addArgs[i + 1] || ""
      i += 1
      continue
    }
    fail(`unknown option: ${token}`)
  }

  if (fromCurrent && (configSourcePath || authSourcePath || presetId || apiKey)) {
    fail("cannot mix --from-current with --config/--auth/--preset/--apikey")
  }

  if (presetId && (configSourcePath || authSourcePath)) {
    fail("cannot mix --preset with --config/--auth")
  }

  if (apiKey && !presetId) {
    fail("--apikey requires --preset <preset-id>")
  }

  if ((configSourcePath && !authSourcePath) || (!configSourcePath && authSourcePath)) {
    fail("both --config and --auth are required")
  }

  return {
    fromCurrent,
    presetId,
    apiKey,
    configSourcePath,
    authSourcePath
  }
}

function presetsCachePaths() {
  const cacheDir = path.join(codexDir, "codex-switch-cache")
  return {
    cacheDir,
    yamlPath: path.join(cacheDir, "presets.yaml"),
    metaPath: path.join(cacheDir, "presets-meta.json")
  }
}

function parsePresetsYaml(yamlText) {
  const templateProviderPresets = parseTemplateProvidersYaml(yamlText)
  if (Object.keys(templateProviderPresets).length > 0) {
    return templateProviderPresets
  }

  const directPresets = parseDirectPresetsYaml(yamlText)
  if (Object.keys(directPresets).length > 0) {
    return directPresets
  }
  return parseLegacyPresetsYaml(yamlText)
}

function parseTemplateProvidersYaml(yamlText) {
  const lines = yamlText.replace(/\r/g, "").split("\n")
  const templates = {}
  const providers = {}
  let i = 0

  while (i < lines.length) {
    if (lines[i] === "templates:") {
      i += 1
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i] === "")) {
        if (lines[i] === "") {
          i += 1
          continue
        }

        const templateMatch = lines[i].match(/^  ([^:\s][^:]*)\s*:\s*\|\s*$/)
        if (!templateMatch) {
          i += 1
          continue
        }

        const templateId = templateMatch[1]
        const blockLines = []
        i += 1
        while (i < lines.length && (lines[i].startsWith("    ") || lines[i] === "")) {
          if (lines[i].startsWith("    ")) {
            blockLines.push(lines[i].slice(4))
          } else {
            blockLines.push("")
          }
          i += 1
        }
        while (blockLines.length > 0 && blockLines[blockLines.length - 1] === "") {
          blockLines.pop()
        }
        templates[templateId] = `${blockLines.join("\n")}\n`
      }
      continue
    }

    if (lines[i] === "providers:") {
      i += 1
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i] === "")) {
        if (lines[i] === "") {
          i += 1
          continue
        }

        const providerMatch = lines[i].match(/^  ([^:\s][^:]*)\s*:\s*$/)
        if (!providerMatch) {
          i += 1
          continue
        }

        const providerId = providerMatch[1]
        let templateId = ""
        let providerUrl = ""
        let providerDescription = ""
        const vars = {}
        i += 1
        while (i < lines.length && (lines[i].startsWith("    ") || lines[i] === "")) {
          const urlLineMatch = lines[i].match(/^    url:\s*(.+?)\s*$/)
          if (urlLineMatch) {
            providerUrl = urlLineMatch[1].replace(/^"(.*)"$/, "$1")
            i += 1
            continue
          }

          const descriptionLineMatch = lines[i].match(/^    description:\s*(.+?)\s*$/)
          if (descriptionLineMatch) {
            providerDescription = descriptionLineMatch[1].replace(/^"(.*)"$/, "$1")
            i += 1
            continue
          }

          const templateLineMatch = lines[i].match(/^    template:\s*(.+?)\s*$/)
          if (templateLineMatch) {
            templateId = templateLineMatch[1]
            i += 1
            continue
          }

          const varsStartMatch = lines[i].match(/^    vars:\s*$/)
          if (varsStartMatch) {
            i += 1
            while (i < lines.length && lines[i].startsWith("      ")) {
              const varMatch = lines[i].match(/^      ([A-Za-z0-9_]+):\s*(.+?)\s*$/)
              if (varMatch) {
                vars[varMatch[1]] = varMatch[2].replace(/^"(.*)"$/, "$1")
              }
              i += 1
            }
            continue
          }

          i += 1
        }

        providers[providerId] = {
          templateId,
          url: providerUrl,
          description: providerDescription,
          vars
        }
      }
      continue
    }

    i += 1
  }

  const presets = {}
  for (const providerId of Object.keys(providers)) {
    const provider = providers[providerId]
    const template = templates[provider.templateId]
    if (!template) {
      continue
    }

    let renderedConfig = template
    for (const varName of Object.keys(provider.vars)) {
      const placeholder = `{{${varName}}}`
      renderedConfig = renderedConfig.split(placeholder).join(provider.vars[varName])
    }

    presets[providerId] = {
      config: renderedConfig,
      auth: "",
      url: provider.url || "",
      description: provider.description || ""
    }
  }

  return presets
}

function parseDirectPresetsYaml(yamlText) {
  const lines = yamlText.replace(/\r/g, "").split("\n")
  const presets = {}
  let i = 0
  while (i < lines.length) {
    const presetMatch = lines[i].match(/^([^:\s][^:]*)\s*:\s*\|\s*$/)
    if (!presetMatch) {
      i += 1
      continue
    }

    const presetId = presetMatch[1]
    const blockLines = []
    i += 1
    while (i < lines.length && (lines[i].startsWith("  ") || lines[i] === "")) {
      if (lines[i].startsWith("  ")) {
        blockLines.push(lines[i].slice(2))
      } else {
        blockLines.push("")
      }
      i += 1
    }
    while (blockLines.length > 0 && blockLines[blockLines.length - 1] === "") {
      blockLines.pop()
    }

    if (blockLines.length > 0) {
      presets[presetId] = {
        config: `${blockLines.join("\n")}\n`,
        auth: ""
      }
    }
  }
  return presets
}

function parseLegacyPresetsYaml(yamlText) {
  const lines = yamlText.replace(/\r/g, "").split("\n")
  const presets = {}
  let i = 0
  while (i < lines.length) {
    const profileMatch = lines[i].match(/^  ([^:\s][^:]*)\s*:\s*$/)
    if (!profileMatch) {
      i += 1
      continue
    }

    const profileName = profileMatch[1]
    let configText = ""
    let authText = ""
    i += 1

    while (i < lines.length) {
      if (/^  [^ ].*:\s*$/.test(lines[i])) {
        break
      }

      const configMatch = lines[i].match(/^    config:\s*(.*)\s*$/)
      if (configMatch) {
        if (configMatch[1] === "|") {
          const blockLines = []
          i += 1
          while (i < lines.length && lines[i].startsWith("      ")) {
            blockLines.push(lines[i].slice(6))
            i += 1
          }
          configText = blockLines.join("\n")
          if (blockLines.length > 0) {
            configText = `${configText}\n`
          }
          continue
        }
        configText = configMatch[1].replace(/^"(.*)"$/, "$1")
      }

      const authMatch = lines[i].match(/^    auth:\s*(.*)\s*$/)
      if (authMatch) {
        if (authMatch[1] === "|") {
          const blockLines = []
          i += 1
          while (i < lines.length && lines[i].startsWith("      ")) {
            blockLines.push(lines[i].slice(6))
            i += 1
          }
          authText = blockLines.join("\n")
          if (blockLines.length > 0) {
            authText = `${authText}\n`
          }
          continue
        }
        authText = authMatch[1].replace(/^"(.*)"$/, "$1")
      }

      i += 1
    }

    if (configText || authText) {
      presets[profileName] = {
        config: configText,
        auth: authText
      }
    }
  }
  return presets
}

function readPresetsMeta(metaPath) {
  if (!fs.existsSync(metaPath)) {
    return { updatedAtMs: 0 }
  }
  return JSON.parse(fs.readFileSync(metaPath, "utf8"))
}

function resolvePresetsUrl() {
  return process.env.CODEX_SWITCH_PRESETS_URL || defaultPresetsUrl
}

function resolvePresetsTtlMs() {
  const ttlText = process.env.CODEX_SWITCH_PRESETS_TTL_MS || ""
  if (!ttlText) {
    return defaultPresetsTtlMs
  }
  return Number(ttlText)
}

async function refreshPresetsCacheIfNeeded() {
  const { cacheDir, yamlPath, metaPath } = presetsCachePaths()
  const ttlMs = resolvePresetsTtlMs()
  const meta = readPresetsMeta(metaPath)
  const nowMs = Date.now()
  if (nowMs - (meta.updatedAtMs || 0) < ttlMs) {
    return
  }

  try {
    const response = await fetch(resolvePresetsUrl())
    if (!response.ok) {
      return
    }
    const yamlText = await response.text()
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(yamlPath, yamlText)
    fs.writeFileSync(metaPath, JSON.stringify({ updatedAtMs: nowMs }, null, 2))
  } catch {
    return
  }
}

async function loadPresets() {
  await refreshPresetsCacheIfNeeded()

  const { yamlPath } = presetsCachePaths()
  if (fs.existsSync(yamlPath)) {
    const yamlText = fs.readFileSync(yamlPath, "utf8")
    return parsePresetsYaml(yamlText)
  }

  const bundledYamlText = fs.readFileSync(bundledPresetsPath, "utf8")
  return parsePresetsYaml(bundledYamlText)
}

function listPresetIds(presets) {
  return Object.keys(presets).sort()
}

function presetsSourceLink() {
  const rawUrl = resolvePresetsUrl()
  const match = rawUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
  )
  if (!match) {
    return rawUrl
  }

  const owner = match[1]
  const repo = match[2]
  const branch = match[3]
  const filePath = match[4]
  return `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`
}

function renderAuthJson(apiKey) {
  const auth = {
    OPENAI_API_KEY: apiKey
  }
  return `${JSON.stringify(auth, null, 2)}\n`
}

async function askApiKey() {
  if (!process.stdin.isTTY) {
    fail("--apikey is required in non-interactive mode")
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const value = await rl.question("API key: ")
  rl.close()
  if (!value) {
    fail("apikey cannot be empty")
  }
  return value
}

function editFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "")
  }
  const editor = process.env.EDITOR || "vi"
  const result = spawnSync(editor, [filePath], { stdio: "inherit" })
  if (result.status !== 0) {
    fail(`editor failed: ${editor}`)
  }
}

async function addProfile(profileName, optionArgs) {
  const options = parseAddOptions(optionArgs)
  const paths = profilePaths(profileName)
  if (fs.existsSync(paths.dirPath)) {
    fail(`profile already exists: ${profileName}`)
  }

  fs.mkdirSync(paths.dirPath, { recursive: true })

  if (options.fromCurrent) {
    fs.copyFileSync(path.join(codexDir, "config.toml"), paths.configPath)
    fs.copyFileSync(path.join(codexDir, "auth.json"), paths.authPath)
  } else if (options.configSourcePath) {
    fs.copyFileSync(options.configSourcePath, paths.configPath)
    fs.copyFileSync(options.authSourcePath, paths.authPath)
  } else if (options.presetId) {
    const presets = await loadPresets()
    const preset = presets[options.presetId]
    if (preset && preset.config) {
      const apiKey = options.apiKey || (await askApiKey())
      fs.writeFileSync(paths.configPath, preset.config)
      fs.writeFileSync(paths.authPath, renderAuthJson(apiKey))
    } else {
      fail(`preset not found: ${options.presetId}`)
    }
  } else {
    console.log(`edit config.toml: ${paths.configPath}`)
    editFile(paths.configPath)
    console.log(`edit auth.json: ${paths.authPath}`)
    editFile(paths.authPath)
  }

  switchProfile(profileName, false)
  console.log(`switched to ${profileName}`)
}

async function printPresets() {
  const presets = await loadPresets()
  const ids = listPresetIds(presets)
  if (ids.length > 0) {
    const lines = ids.map((id) => {
      const preset = presets[id] || {}
      const description = preset.description || ""
      const url = preset.url || ""
      return `${id}\t${description}\t${url}`
    })
    console.log(lines.join("\n"))
  }
  console.log(`presets.yaml\t${presetsSourceLink()}`)
}

function editProfile(profileName) {
  const paths = ensureProfileExists(profileName)
  console.log(`edit config.toml: ${paths.configPath}`)
  editFile(paths.configPath)
  console.log(`edit auth.json: ${paths.authPath}`)
  editFile(paths.authPath)
  switchProfile(profileName, false)
  console.log(`switched to ${profileName}`)
}

function deleteProfile(profileName) {
  const paths = ensureProfileExists(profileName)
  const currentProfile = getCurrentProfileName()
  if (currentProfile === profileName) {
    fail(
      `profile is current: ${profileName}\nswitch to another profile first\nexample: codex-switch <other-profile> && codex-switch delete ${profileName}`
    )
  }
  fs.rmSync(paths.dirPath, { recursive: true, force: true })
  console.log(`deleted ${profileName}`)
}

function zshCompletionScript() {
  return `#compdef codex-switch

_codex_switch_profiles() {
  local -a profiles
  profiles=("\${(@f)\$(codex-switch list 2>/dev/null)}")
  _describe 'profile' profiles
}

_codex_switch() {
  local -a commands
  commands=(
    'add:add profile'
    'edit:edit profile'
    'rm:remove profile'
    'list:list profiles'
    'presets:list presets'
    'current:show current profile'
    'completion:print shell completion script'
  )

  if (( CURRENT == 2 )); then
    _alternative 'commands:command:->cmds' 'profiles:profile:_codex_switch_profiles'
    return
  fi

  case "$words[2]" in
    add|edit|rm)
      if (( CURRENT == 3 )); then
        _codex_switch_profiles
      fi
      ;;
    completion)
      _values 'shell' zsh bash fish powershell
      ;;
    *)
      if (( CURRENT == 2 )); then
        _describe 'command' commands
      fi
      ;;
  esac
}

_codex_switch "$@"
`
}

function bashCompletionScript() {
  return `_codex_switch_profiles() {
  codex-switch list 2>/dev/null
}

_codex_switch() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="add edit rm list presets current completion"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    local profiles
    profiles="$(_codex_switch_profiles)"
    COMPREPLY=( $(compgen -W "\${commands} \${profiles}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${prev}" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "zsh bash fish powershell" -- "\${cur}") )
    return 0
  fi

  if [[ "\${COMP_WORDS[1]}" == "add" || "\${COMP_WORDS[1]}" == "edit" || "\${COMP_WORDS[1]}" == "rm" ]]; then
    local profiles
    profiles="$(_codex_switch_profiles)"
    COMPREPLY=( $(compgen -W "\${profiles}" -- "\${cur}") )
    return 0
  fi
}

complete -F _codex_switch codex-switch
`
}

function fishCompletionScript() {
  return `function __codex_switch_profiles
  codex-switch list 2>/dev/null
end

complete -c codex-switch -f
complete -c codex-switch -n '__fish_use_subcommand' -a 'add edit rm list presets current completion (__codex_switch_profiles)'
complete -c codex-switch -n '__fish_seen_subcommand_from add edit rm' -a '(__codex_switch_profiles)'
complete -c codex-switch -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish powershell'
`
}

function powershellCompletionScript() {
  return `Register-ArgumentCompleter -Native -CommandName codex-switch -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = $commandAst.CommandElements | ForEach-Object { $_.Extent.Text }
  $commands = @('add', 'edit', 'rm', 'list', 'presets', 'current', 'completion')
  $profiles = @(codex-switch list 2>$null)
  $candidates = @()

  if ($words.Count -le 2) {
    $candidates = $commands + $profiles
  } elseif ($words[1] -eq 'completion') {
    $candidates = @('zsh', 'bash', 'fish', 'powershell')
  } elseif ($words[1] -eq 'add' -or $words[1] -eq 'edit' -or $words[1] -eq 'rm') {
    $candidates = $profiles
  }

  $candidates |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`
}

function completionScript(shellName) {
  if (shellName === "zsh") {
    return zshCompletionScript()
  }
  if (shellName === "bash") {
    return bashCompletionScript()
  }
  if (shellName === "fish") {
    return fishCompletionScript()
  }
  if (shellName === "powershell") {
    return powershellCompletionScript()
  }
  fail(`unsupported shell: ${shellName}`)
}

function printCompletion(shellName) {
  console.log(completionScript(shellName))
}

function detectShellName() {
  if (process.platform === "win32") {
    return "powershell"
  }
  const shellPath = process.env.SHELL || ""
  if (shellPath.endsWith("/zsh")) {
    return "zsh"
  }
  if (shellPath.endsWith("/bash")) {
    return "bash"
  }
  if (shellPath.endsWith("/fish")) {
    return "fish"
  }
  fail("cannot detect shell, use: codex-switch completion install <shell>")
}

function appendIfMissing(filePath, marker, block) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
  if (content.includes(marker)) {
    return
  }
  const next = content.endsWith("\n") || content.length === 0 ? content : `${content}\n`
  fs.writeFileSync(filePath, `${next}${block}\n`)
}

function installCompletion(shellName) {
  const resolvedShell = shellName || detectShellName()
  const homeDir = os.homedir()

  if (resolvedShell === "zsh") {
    const zfuncDir = path.join(homeDir, ".zfunc")
    const completionPath = path.join(zfuncDir, "_codex-switch")
    fs.mkdirSync(zfuncDir, { recursive: true })
    fs.writeFileSync(completionPath, completionScript("zsh"))
    const zshrcPath = path.join(homeDir, ".zshrc")
    appendIfMissing(
      zshrcPath,
      "# codex-switch completion",
      "# codex-switch completion\nfpath=(~/.zfunc $fpath)\nautoload -Uz compinit && compinit"
    )
    console.log(`installed zsh completion: ${completionPath}`)
    return
  }

  if (resolvedShell === "bash") {
    const dirPath = path.join(homeDir, ".local", "share", "bash-completion", "completions")
    const completionPath = path.join(dirPath, "codex-switch")
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(completionPath, completionScript("bash"))
    console.log(`installed bash completion: ${completionPath}`)
    return
  }

  if (resolvedShell === "fish") {
    const dirPath = path.join(homeDir, ".config", "fish", "completions")
    const completionPath = path.join(dirPath, "codex-switch.fish")
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(completionPath, completionScript("fish"))
    console.log(`installed fish completion: ${completionPath}`)
    return
  }

  if (resolvedShell === "powershell") {
    const codexHomeDir = path.join(homeDir, ".codex")
    const completionPath = path.join(codexHomeDir, "codex-switch-completion.ps1")
    fs.mkdirSync(codexHomeDir, { recursive: true })
    fs.writeFileSync(completionPath, completionScript("powershell"))

    const profileDirPath = path.join(homeDir, "Documents", "PowerShell")
    const profilePath = path.join(profileDirPath, "Microsoft.PowerShell_profile.ps1")
    fs.mkdirSync(profileDirPath, { recursive: true })
    appendIfMissing(
      profilePath,
      "# codex-switch completion",
      `# codex-switch completion\n. '${completionPath.replace(/'/g, "''")}'`
    )
    console.log(`installed powershell completion: ${profilePath}`)
    return
  }

  fail(`unsupported shell: ${resolvedShell}`)
}

async function run() {
  if (args.length === 0 || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    help()
    process.exit(0)
  }

  const command = args[0]

  if (command === "list") {
    listProfiles()
    return
  }

  if (command === "presets") {
    await printPresets()
    return
  }

  if (command === "current") {
    console.log(getCurrentProfileName())
    return
  }

  if (command === "completion") {
    if (args.length === 1) {
      installCompletion("")
      return
    }

    const shellName = args[1]
    if (!shellName || args.length !== 2) {
      usage()
      process.exit(1)
    }
    printCompletion(shellName)
    return
  }

  if (command === "add") {
    const profileName = args[1]
    if (!profileName) {
      usage()
      process.exit(1)
    }
    await addProfile(profileName, args.slice(2))
    return
  }

  if (command === "edit") {
    const profileName = args[1]
    if (!profileName || args.length !== 2) {
      usage()
      process.exit(1)
    }
    editProfile(profileName)
    return
  }

  if (command === "rm") {
    const profileName = args[1]
    if (!profileName || args.length !== 2) {
      usage()
      process.exit(1)
    }
    deleteProfile(profileName)
    return
  }

  const profileName = command
  let useCopy = false
  if (args.length > 1) {
    if (args.length === 2 && args[1] === "--copy") {
      useCopy = true
    } else {
      usage()
      process.exit(1)
    }
  }

  switchProfile(profileName, useCopy)
  console.log(`switched to ${profileName}`)
}

run().catch((error) => {
  fail(String(error))
})
