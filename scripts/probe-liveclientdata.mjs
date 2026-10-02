#!/usr/bin/env node
// 海克斯卡片探测脚本 (方案 A 二期预研)
//
// 用法: node scripts/probe-liveclientdata.mjs [输出文件]
//
// 在斗魂竞技场(CHERRY)或海克斯大乱斗(KIWI)对局进行时运行本脚本,
// 它会每秒轮询游戏客户端 2999 端口的 Live Client Data API,
// 将完整响应追加写入 JSONL 文件, 并在控制台打印新出现的事件类型。
//
// 目的: 确认 API 是否暴露 "当前弹出的 3 张海克斯卡片" 的 augmentId,
// 以决定是否可以升级为逐卡标注方案。对局结束后把输出文件发给开发者分析。
import { createWriteStream } from 'node:fs'
import https from 'node:https'

const INTERVAL_MS = 1000
const REQUEST_TIMEOUT_MS = 3000
const OUT_FILE = process.argv[2] ?? 'liveclientdata-probe.jsonl'

const agent = new https.Agent({ rejectUnauthorized: false })

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://127.0.0.1:2999${path}`,
      { agent, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
  })
}

async function main() {
  console.log(`[augment-probe] 开始探测, 输出文件: ${OUT_FILE}`)
  console.log(
    '[augment-probe] 请进入斗魂竞技场或海克斯大乱斗对局, 直到至少完成一次海克斯选择。按 Ctrl+C 结束。'
  )

  const stream = createWriteStream(OUT_FILE, { flags: 'a' })
  const knownEventNames = new Set()

  const timer = setInterval(async () => {
    const timestamp = new Date().toISOString()

    let allGameData
    try {
      allGameData = await fetchJson('/liveclientdata/allgamedata')
    } catch {
      // 游戏未运行或接口未就绪, 静默重试
      return
    }

    stream.write(JSON.stringify({ timestamp, allGameData }) + '\n')

    const events = allGameData?.events?.Events ?? []
    for (const event of events) {
      const name = event?.EventName ?? event?.eventName ?? 'unknown'
      if (!knownEventNames.has(name)) {
        knownEventNames.add(name)
        console.log(`[augment-probe] ${timestamp} 发现新事件类型: ${name}`)
        console.log(`[augment-probe] 事件样例: ${JSON.stringify(event)}`)
      }
    }
  }, INTERVAL_MS)

  process.on('SIGINT', () => {
    clearInterval(timer)
    stream.end()
    console.log(
      `\n[augment-probe] 已停止, 共记录 ${knownEventNames.size} 种事件类型, 输出文件: ${OUT_FILE}`
    )
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('[augment-probe] 启动失败:', error)
  process.exit(1)
})
