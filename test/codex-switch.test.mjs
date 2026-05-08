import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const WORKDIR = "/Users/wangyusong/Documents/doc/codex-switch"
const CLI_PATH = path.join(WORKDIR, "bin", "codex-switch.mjs")

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-"))
}

function runCli(args, homeDir, extraEnv = {}) {
  return spawnSync("node", [CLI_PATH, ...args], {
    cwd: WORKDIR,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...extraEnv
    }
  })
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content)
}

test("add profile with --config and --auth then current should be that profile", () => {
  const homeDir = makeHome()
  const cfgPath = path.join(homeDir, "input-config.toml")
  const authPath = path.join(homeDir, "input-auth.json")
  writeFile(cfgPath, "provider = 'openai'\n")
  writeFile(authPath, "{\"token\":\"a\"}\n")

  const addResult = runCli(["add", "openai", "--config", cfgPath, "--auth", authPath], homeDir)
  assert.equal(addResult.status, 0)

  const currentResult = runCli(["current"], homeDir)
  assert.equal(currentResult.status, 0)
  assert.equal(currentResult.stdout.trim(), "openai")

  const profileConfig = path.join(homeDir, ".codex", "profiles", "openai", "config.toml")
  const profileAuth = path.join(homeDir, ".codex", "profiles", "openai", "auth.json")
  assert.equal(fs.readFileSync(profileConfig, "utf8"), "provider = 'openai'\n")
  assert.equal(fs.readFileSync(profileAuth, "utf8"), "{\"token\":\"a\"}\n")
})

test("presets should list preset ids from yaml", () => {
  const homeDir = makeHome()
  const yaml = `templates:
  responsesApi: |
    base_url = "{{BASE_URL}}"

providers:
  openrouter:
    url: https://openrouter.ai/api/v1
    description: OpenRouter
    template: responsesApi
    vars:
      BASE_URL: https://openrouter.ai/api/v1
  glidea:
    url: https://token.glidea.app
    description: G
    template: responsesApi
    vars:
      BASE_URL: https://token.glidea.app
`
  const presetsUrl = `data:text/plain,${encodeURIComponent(yaml)}`
  const result = runCli(["presets"], homeDir, {
    CODEX_SWITCH_PRESETS_URL: presetsUrl,
    CODEX_SWITCH_PRESETS_TTL_MS: "300000"
  })
  assert.equal(result.status, 0)
  const lines = result.stdout.trim().split("\n")
  assert.equal(lines[0], "glidea\tG\thttps://token.glidea.app")
  assert.equal(lines[1], "openrouter\tOpenRouter\thttps://openrouter.ai/api/v1")
  assert.equal(lines[2], `presets.yaml\t${presetsUrl}`)
})

test("add profile with --preset <id> --apikey should fetch yaml preset then use cache when ttl not expired", () => {
  const homeDir = makeHome()
  const firstYaml = `openrouter: |
  base_url = "https://openrouter.ai/api/v1"
glidea2: |
  base_url = "https://token.glidea.app/one"
`
  const secondYaml = `glidea2: |
  base_url = "https://token.glidea.app/two"
`
  const firstAddResult = runCli(
    ["add", "router1", "--preset", "openrouter", "--apikey", "sk-router-1"],
    homeDir,
    {
      CODEX_SWITCH_PRESETS_URL: `data:text/plain,${encodeURIComponent(firstYaml)}`,
      CODEX_SWITCH_PRESETS_TTL_MS: "300000"
    }
  )
  assert.equal(firstAddResult.status, 0)
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "router1", "config.toml"), "utf8"),
    "base_url = \"https://openrouter.ai/api/v1\"\n"
  )
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "router1", "auth.json"), "utf8"),
    "{\n  \"OPENAI_API_KEY\": \"sk-router-1\"\n}\n"
  )

  const secondAddResult = runCli(
    ["add", "router2", "--preset", "glidea2", "--apikey", "sk-router-2"],
    homeDir,
    {
      CODEX_SWITCH_PRESETS_URL: `data:text/plain,${encodeURIComponent(secondYaml)}`,
      CODEX_SWITCH_PRESETS_TTL_MS: "300000"
    }
  )
  assert.equal(secondAddResult.status, 0)
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "router2", "config.toml"), "utf8"),
    "base_url = \"https://token.glidea.app/one\"\n"
  )
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "router2", "auth.json"), "utf8"),
    "{\n  \"OPENAI_API_KEY\": \"sk-router-2\"\n}\n"
  )
})

test("add profile should accept --apiKey alias", () => {
  const homeDir = makeHome()
  const yaml = `templates:
  responsesApi: |
    base_url = "{{BASE_URL}}"

providers:
  glidea:
    template: responsesApi
    vars:
      BASE_URL: https://token.glidea.app
`
  const result = runCli(
    ["add", "glidea", "--preset", "glidea", "--apiKey", "sk-alias"],
    homeDir,
    {
      CODEX_SWITCH_PRESETS_URL: `data:text/plain,${encodeURIComponent(yaml)}`,
      CODEX_SWITCH_PRESETS_TTL_MS: "300000"
    }
  )
  assert.equal(result.status, 0)
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "glidea", "auth.json"), "utf8"),
    "{\n  \"OPENAI_API_KEY\": \"sk-alias\"\n}\n"
  )
})

test("add glidea with --preset <id> should fallback to bundled yaml preset when remote fetch fails", () => {
  const homeDir = makeHome()
  const result = runCli(["add", "glidea", "--preset", "glidea", "--apikey", "sk-g"], homeDir, {
    CODEX_SWITCH_PRESETS_URL: "http://127.0.0.1:1/presets.yaml",
    CODEX_SWITCH_PRESETS_TTL_MS: "0"
  })
  assert.equal(result.status, 0)
  const configText = fs.readFileSync(
    path.join(homeDir, ".codex", "profiles", "glidea", "config.toml"),
    "utf8"
  )
  assert.match(configText, /base_url = "https:\/\/token\.glidea\.app"/)
  assert.match(configText, /model_provider = "OpenAI"/)
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "glidea", "auth.json"), "utf8"),
    "{\n  \"OPENAI_API_KEY\": \"sk-g\"\n}\n"
  )
})

test("add with --preset <id> without --apikey should fail in non-interactive mode", () => {
  const homeDir = makeHome()
  const yaml = `glidea: |
  base_url = "https://token.glidea.app"
`
  const result = runCli(["add", "glidea", "--preset", "glidea"], homeDir, {
    CODEX_SWITCH_PRESETS_URL: `data:text/plain,${encodeURIComponent(yaml)}`,
    CODEX_SWITCH_PRESETS_TTL_MS: "300000"
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--apikey is required in non-interactive mode/)
})

test("add glidea without --preset should not use yaml preset", () => {
  const homeDir = makeHome()
  const editorPath = path.join(homeDir, "fake-editor-noop.mjs")
  writeFile(editorPath, "#!/usr/bin/env node\nprocess.exit(0)\n")
  fs.chmodSync(editorPath, 0o755)

  const result = runCli(["add", "glidea"], homeDir, { EDITOR: editorPath })
  assert.equal(result.status, 0)
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "glidea", "config.toml"), "utf8"),
    ""
  )
  assert.equal(
    fs.readFileSync(path.join(homeDir, ".codex", "profiles", "glidea", "auth.json"), "utf8"),
    ""
  )
})

test("add profile should reject mixing --preset with --from-current", () => {
  const homeDir = makeHome()
  const result = runCli(["add", "glidea", "--preset", "glidea", "--from-current"], homeDir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cannot mix --from-current with --config\/--auth\/--preset\/--apikey/)
})

test("switch profile should point to target profile", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  const glideaDir = path.join(codexDir, "profiles", "glidea")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'openai'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"o\"}\n")
  writeFile(path.join(glideaDir, "config.toml"), "provider = 'glidea'\n")
  writeFile(path.join(glideaDir, "auth.json"), "{\"token\":\"g\"}\n")

  const switchResult = runCli(["glidea"], homeDir)
  assert.equal(switchResult.status, 0)

  const currentResult = runCli(["current"], homeDir)
  assert.equal(currentResult.status, 0)
  assert.equal(currentResult.stdout.trim(), "glidea")

  const listResult = runCli(["list"], homeDir)
  assert.equal(listResult.status, 0)
  assert.equal(listResult.stdout.trim(), "glidea\nopenai")
})

test("switch with --copy should write regular files", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'openai'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"o\"}\n")

  const result = runCli(["openai", "--copy"], homeDir)
  assert.equal(result.status, 0)

  const rootConfig = path.join(codexDir, "config.toml")
  const rootAuth = path.join(codexDir, "auth.json")
  const configStat = fs.lstatSync(rootConfig)
  const authStat = fs.lstatSync(rootAuth)
  assert.equal(configStat.isSymbolicLink(), false)
  assert.equal(authStat.isSymbolicLink(), false)
  assert.equal(fs.readFileSync(rootConfig, "utf8"), "provider = 'openai'\n")
  assert.equal(fs.readFileSync(rootAuth, "utf8"), "{\"token\":\"o\"}\n")
})

test("edit profile should update both files and switch to profile", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'old'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"old\"}\n")

  const editorPath = path.join(homeDir, "fake-editor.mjs")
  writeFile(
    editorPath,
    "#!/usr/bin/env node\n" +
      "import fs from 'node:fs'\n" +
      "const filePath = process.argv[2]\n" +
      "if (filePath.endsWith('config.toml')) fs.writeFileSync(filePath, \"provider = 'edited'\\n\")\n" +
      "if (filePath.endsWith('auth.json')) fs.writeFileSync(filePath, '{\"token\":\"edited\"}\\n')\n"
  )
  fs.chmodSync(editorPath, 0o755)

  const editResult = runCli(["edit", "openai"], homeDir, { EDITOR: editorPath })
  assert.equal(editResult.status, 0)

  assert.equal(
    fs.readFileSync(path.join(openaiDir, "config.toml"), "utf8"),
    "provider = 'edited'\n"
  )
  assert.equal(
    fs.readFileSync(path.join(openaiDir, "auth.json"), "utf8"),
    "{\"token\":\"edited\"}\n"
  )

  const currentResult = runCli(["current"], homeDir)
  assert.equal(currentResult.status, 0)
  assert.equal(currentResult.stdout.trim(), "openai")
})

test("edit profile should keep file content when editor does not write", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'old'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"old\"}\n")

  const editorPath = path.join(homeDir, "fake-editor-noop.mjs")
  writeFile(editorPath, "#!/usr/bin/env node\nprocess.exit(0)\n")
  fs.chmodSync(editorPath, 0o755)

  const editResult = runCli(["edit", "openai"], homeDir, { EDITOR: editorPath })
  assert.equal(editResult.status, 0)
  assert.equal(fs.readFileSync(path.join(openaiDir, "config.toml"), "utf8"), "provider = 'old'\n")
  assert.equal(fs.readFileSync(path.join(openaiDir, "auth.json"), "utf8"), "{\"token\":\"old\"}\n")
})

test("completion should print scripts for zsh bash fish powershell", () => {
  const homeDir = makeHome()

  const zshResult = runCli(["completion", "zsh"], homeDir)
  assert.equal(zshResult.status, 0)
  assert.match(zshResult.stdout, /'add:add profile'/)
  assert.match(zshResult.stdout, /'edit:edit profile'/)
  assert.match(zshResult.stdout, /'rm:remove profile'/)
  assert.match(zshResult.stdout, /'presets:list presets'/)
  assert.match(zshResult.stdout, /_values 'shell' zsh bash fish powershell/)

  const bashResult = runCli(["completion", "bash"], homeDir)
  assert.equal(bashResult.status, 0)
  assert.match(bashResult.stdout, /local commands="add edit rm list presets current completion"/)
  assert.match(bashResult.stdout, /complete -F _codex_switch codex-switch/)

  const fishResult = runCli(["completion", "fish"], homeDir)
  assert.equal(fishResult.status, 0)
  assert.match(fishResult.stdout, /add edit rm list presets current completion/)
  assert.match(fishResult.stdout, /complete -c codex-switch/)

  const powershellResult = runCli(["completion", "powershell"], homeDir)
  assert.equal(powershellResult.status, 0)
  assert.match(powershellResult.stdout, /Register-ArgumentCompleter/)
})

test("completion without shell should auto install", () => {
  const homeDir = makeHome()
  const result = runCli(["completion"], homeDir, { SHELL: "/bin/zsh" })
  assert.equal(result.status, 0)
  const zshCompletionPath = path.join(homeDir, ".zfunc", "_codex-switch")
  const zshrcPath = path.join(homeDir, ".zshrc")
  assert.equal(fs.existsSync(zshCompletionPath), true)
  assert.equal(fs.existsSync(zshrcPath), true)
  assert.match(fs.readFileSync(zshCompletionPath, "utf8"), /#compdef codex-switch/)
  assert.match(fs.readFileSync(zshrcPath, "utf8"), /# codex-switch completion/)
})

test("completion install paths should work by explicit shell", () => {
  const homeDir = makeHome()

  const zshInstallResult = runCli(["completion"], homeDir, { SHELL: "/bin/zsh" })
  assert.equal(zshInstallResult.status, 0)
  const zshCompletionPath = path.join(homeDir, ".zfunc", "_codex-switch")
  const zshrcPath = path.join(homeDir, ".zshrc")
  assert.equal(fs.existsSync(zshCompletionPath), true)
  assert.equal(fs.existsSync(zshrcPath), true)
  assert.match(fs.readFileSync(zshCompletionPath, "utf8"), /#compdef codex-switch/)
  assert.match(fs.readFileSync(zshrcPath, "utf8"), /# codex-switch completion/)

  const bashInstallResult = runCli(["completion"], homeDir, { SHELL: "/bin/bash" })
  assert.equal(bashInstallResult.status, 0)
  const bashCompletionPath = path.join(
    homeDir,
    ".local",
    "share",
    "bash-completion",
    "completions",
    "codex-switch"
  )
  assert.equal(fs.existsSync(bashCompletionPath), true)
  assert.match(fs.readFileSync(bashCompletionPath, "utf8"), /complete -F _codex_switch/)

  const fishInstallResult = runCli(["completion"], homeDir, { SHELL: "/usr/local/bin/fish" })
  assert.equal(fishInstallResult.status, 0)
  const fishCompletionPath = path.join(
    homeDir,
    ".config",
    "fish",
    "completions",
    "codex-switch.fish"
  )
  assert.equal(fs.existsSync(fishCompletionPath), true)
  assert.match(fs.readFileSync(fishCompletionPath, "utf8"), /complete -c codex-switch/)

  const powershellInstallResult = runCli(["completion", "powershell"], homeDir)
  assert.equal(powershellInstallResult.status, 0)
  assert.match(powershellInstallResult.stdout, /Register-ArgumentCompleter/)
})

test("completion should install powershell by platform detection", () => {
  const homeDir = makeHome()
  const powershellInstallResult = runCli(["completion"], homeDir, { SHELL: "" })
  if (process.platform !== "win32") {
    assert.equal(powershellInstallResult.status, 1)
    return
  }
  assert.equal(powershellInstallResult.status, 0)
  const psCompletionPath = path.join(homeDir, ".codex", "codex-switch-completion.ps1")
  const psProfilePath = path.join(
    homeDir,
    "Documents",
    "PowerShell",
    "Microsoft.PowerShell_profile.ps1"
  )
  assert.equal(fs.existsSync(psCompletionPath), true)
  assert.equal(fs.existsSync(psProfilePath), true)
  assert.match(fs.readFileSync(psCompletionPath, "utf8"), /Register-ArgumentCompleter/)
  assert.match(fs.readFileSync(psProfilePath, "utf8"), /# codex-switch completion/)
})

test("help should print usage and return zero", () => {
  const homeDir = makeHome()
  const result = runCli(["--help"], homeDir)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /usage: codex-switch/)
  assert.match(result.stdout, /codex-switch completion/)
})

test("completion command should not be treated as profile name", () => {
  const homeDir = makeHome()
  const result = runCli(["completion"], homeDir, { SHELL: "/bin/zsh" })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /installed zsh completion/)
})

test("rm without profile should print usage", () => {
  const homeDir = makeHome()
  const result = runCli(["rm"], homeDir)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /usage: codex-switch/)
  assert.doesNotMatch(result.stderr, /profile not found: rm/)
})

test("rm should remove non-current profile", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  const glideaDir = path.join(codexDir, "profiles", "glidea")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'openai'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"o\"}\n")
  writeFile(path.join(glideaDir, "config.toml"), "provider = 'glidea'\n")
  writeFile(path.join(glideaDir, "auth.json"), "{\"token\":\"g\"}\n")

  const switchResult = runCli(["openai"], homeDir)
  assert.equal(switchResult.status, 0)

  const rmResult = runCli(["rm", "glidea"], homeDir)
  assert.equal(rmResult.status, 0)
  assert.match(rmResult.stdout, /deleted glidea/)
  assert.equal(fs.existsSync(glideaDir), false)
})

test("rm current profile should fail", () => {
  const homeDir = makeHome()
  const codexDir = path.join(homeDir, ".codex")
  const openaiDir = path.join(codexDir, "profiles", "openai")
  const glideaDir = path.join(codexDir, "profiles", "glidea")
  writeFile(path.join(openaiDir, "config.toml"), "provider = 'openai'\n")
  writeFile(path.join(openaiDir, "auth.json"), "{\"token\":\"o\"}\n")
  writeFile(path.join(glideaDir, "config.toml"), "provider = 'glidea'\n")
  writeFile(path.join(glideaDir, "auth.json"), "{\"token\":\"g\"}\n")

  const switchResult = runCli(["openai"], homeDir)
  assert.equal(switchResult.status, 0)

  const rmResult = runCli(["rm", "openai"], homeDir)
  assert.equal(rmResult.status, 1)
  assert.match(rmResult.stderr, /profile is current: openai/)
  assert.equal(fs.existsSync(openaiDir), true)
})
