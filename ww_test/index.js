const express = require('express');
const app = express();
const PORT = 4000;

let callbackCode = null;
let callbackState = null;

app.get('/api/wechat/callback', (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  
  if (code) {
    callbackCode = code;
    callbackState = state;
    console.log(`[WECHAT] 收到授权回调: code=${code}, state=${state}`);
    res.send('授权成功！请返回终端查看结果。');
  } else {
    const errmsg = req.query.errmsg || '未知错误';
    console.log(`[WECHAT] 授权失败: ${errmsg}`);
    res.send(`授权失败: ${errmsg}`);
  }
});

app.get('/api/wechat/callback_result', (req, res) => {
  res.json({
    code: callbackCode || 'waiting',
    state: callbackState || null
  });
});

app.get('/api/wechat/reset', (req, res) => {
  callbackCode = null;
  callbackState = null;
  res.json({ success: true, message: '已重置' });
});

app.listen(PORT, () => {
  console.log(`微信授权测试服务已启动，端口: ${PORT}`);
  console.log(`回调地址: http://localhost:${PORT}/api/wechat/callback`);
  console.log(`轮询地址: http://localhost:${PORT}/api/wechat/callback_result`);
});