import WebSocket from 'ws'
const url = 'ws://127.0.0.1:7419/companion'
const ws = new WebSocket(url)
const seen = []
ws.on('open', () => {
  console.log('OPEN')
  ws.send(JSON.stringify({ type: 'subscribe', channels: ['status'] }))
  ws.send(JSON.stringify({ type: 'ping' }))
  ws.send(JSON.stringify({ type: 'get_inventory' }))
  setTimeout(() => ws.send(JSON.stringify({ type: 'intent', intent: 'stop_all' })), 400)
  setTimeout(() => ws.send(JSON.stringify({ type: 'intent', intent: 'town_run' })), 800)
  setTimeout(() => ws.send('this is not json'), 1000)
  setTimeout(() => { ws.close(); }, 1600)
})
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  seen.push(m.type)
  if (m.type === 'status') {
    const p = m.payload
    console.log(`STATUS name=${p.name} guild=${p.guild} inst=${p.instance} favors=${p.favors} hp=${p.vitals.health} situation=[${p.situation}] skills=${p.skills.length} activity="${p.activity}"`)
    const ev = p.skills.find(s => s.name === 'Evasion')
    console.log(`  Evasion ranks=${ev.ranks} mindstate=${ev.mindstate} set=${ev.skillset}`)
  } else if (m.type === 'hello') {
    console.log(`HELLO protocol=${m.protocol} bridge=${m.bridgeVersion} lich=${m.lichVersion}`)
  } else if (m.type === 'intent_ack') {
    console.log(`ACK ${m.intent} ok=${m.ok} detail="${m.detail}"`)
  } else if (m.type === 'scripts') {
    console.log(`SCRIPTS ${JSON.stringify(m.payload)}`)
  } else if (m.type === 'inventory') {
    console.log(`INVENTORY containers=${m.payload.containers.length} worn=${m.payload.wornCount}`)
  } else if (m.type === 'log') {
    console.log(`LOG [${m.level||'info'}] ${m.line}`)
  } else if (m.type === 'error') {
    console.log(`ERROR ${m.message}`)
  }
})
ws.on('close', () => { console.log('CLOSED. types seen: ' + [...new Set(seen)].join(',')); process.exit(0) })
ws.on('error', (e) => { console.log('WS ERROR ' + e.message); process.exit(1) })
