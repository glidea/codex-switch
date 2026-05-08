# codex-switch

English README: [README.en.md](./README.en.md)

一个超轻量命令行工具  
只做一件事  
一键切换 Codex 的 `config.toml` 和 `auth.json`

特点
- 简单：核心命令只有几个
- 轻量：无运行时依赖
- 透明：本质就是管理两个文件

## 安装

```bash
npm install -g @glidea/codex-switch
```

不想安装也可以直接用

```bash
npx @glidea/codex-switch list
```

## 快速上手

1. 把你当前官方订阅配置保存成 `openai`

```bash
codex-switch add openai --from-current
```

2. 查看可用预设

```bash
codex-switch presets
```

3. 用预设一键新建 `glidea`

```bash
codex-switch add glidea --preset glidea --apikey sk-xxx
```

如果不带 `--apikey` 会交互输入

```bash
codex-switch add glidea --preset glidea
```

4. 随时切换

```bash
codex-switch openai
codex-switch glidea
```

5. 切换后重启 Codex

已运行的 Codex 会话不会热更新配置  
重启后才会读取新配置

## 常用命令

```bash
codex-switch <profile>
codex-switch add <profile>
codex-switch presets
codex-switch current
codex-switch list
codex-switch edit <profile>
codex-switch rm <profile>
codex-switch completion
```

高级命令

```bash
codex-switch add <profile> --from-current
codex-switch add <profile> --config <path> --auth <path>
codex-switch add <profile> --preset <preset-id> --apikey <key>
codex-switch add <profile> --preset <preset-id>
codex-switch <profile> --copy
codex-switch completion <zsh|bash|fish|powershell>
```

## 文件结构

```text
~/.codex/
  config.toml -> profiles/openai/config.toml
  auth.json   -> profiles/openai/auth.json
  profiles/
    openai/
      config.toml
      auth.json
    glidea/
      config.toml
      auth.json
```

默认是软链接模式

```bash
codex-switch <profile>
```

如果你在 Windows 上遇到软链接权限问题  
用复制模式

```bash
codex-switch <profile> --copy
```

## 发布

```bash
./scripts/publish-with-token.sh <NPM_TOKEN>
```
