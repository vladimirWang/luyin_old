# 建筑会议智能问答评测集

`architecture_dataset.json` 是由 `architecture_dataset.py` 生成的合成评测数据，不包含真实项目或个人信息。

数据覆盖：

- 3 个建筑项目：商业办公、住宅、公共文化建筑
- 12 场会议、120 段带角色和时间轴的转写
- 方案、消防、幕墙、机电、成本、质量、安全、交付、声学等专业场景
- 20 个事实、时序、对比、追问、语义召回和证据不足问题
- 每个问题包含标准证据段、必答事实，必要时包含禁止断言

常用命令：

```powershell
npm run seed:architecture
npm run eval:architecture
node scripts/run-python.mjs -m backend.evals.run_architecture_eval --live --live-limit 5
```

`seed:architecture` 使用固定 ID 幂等写入 MySQL，不删除其他录音。离线评测验证检索命中；`--live` 还会调用当前配置的大语言模型，验证答案关键词和引用证据。
