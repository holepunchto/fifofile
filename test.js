const FF = require('./')
const test = require('brittle')
const tmp = require('test-tmp')
const path = require('path')
const fs = require('fs')

test('basic', async function (t) {
  const dir = await tmp(t)

  const f = new FF(path.join(dir, 'fifo'))
  let sent = 0

  for (let i = 0; i < 1e5; i++) {
    sent++
    f.write(Buffer.from('#' + i))
  }

  f.end()
  await new Promise((resolve) => f.on('finish', resolve))
  let recv = 0
  for await (const data of f) {
    if (!data.equals(Buffer.from('#' + recv++))) {
      t.fail('unexpected data')
      return
    }

    if (recv === sent) break
  }

  t.is(recv, sent)
})

test('multiple write sessions', async function (t) {
  const dir = await tmp(t)

  let sent = 0

  for (let i = 0; i < 100; i++) {
    const f = new FF(path.join(dir, 'fifo'))

    for (let i = 0; i < 1e3; i++) {
      f.write(Buffer.from('#' + sent))
      sent++
    }

    f.end()
    await new Promise((resolve) => f.on('finish', resolve))
    f.destroy()
    await new Promise((resolve) => f.on('close', resolve))
  }

  const f = new FF(path.join(dir, 'fifo'))

  let recv = 0
  for await (const data of f) {
    if (!data.equals(Buffer.from('#' + recv++))) {
      t.fail('unexpected data')
      return
    }

    if (recv === sent) break
  }

  t.is(recv, sent)
})

test('messages over the limit are ignored', async function (t) {
  const dir = await tmp(t)

  const f = new FF(path.join(dir, 'fifo'))

  for (let i = 0; i < 1e4; i++) {
    f.write(Buffer.from('#' + i))
  }

  f.end()
  await new Promise((resolve) => f.on('finish', resolve))
  f.destroy()
  await new Promise((resolve) => f.on('close', resolve))

  const f2 = new FF(path.join(dir, 'fifo'), { maxSize: 4 })

  let recv = 0
  let last = null

  try {
    for await (const data of f2) {
      recv++
      last = data
      if (recv === 1000) {
        setTimeout(() => f2.destroy(), 2000)
      }
    }
  } catch {
    // ignore
  }

  t.is(recv, 1000)
  t.is(last.toString(), '#999')
})

test('messages are checksummed', async function (t) {
  const dir = await tmp(t)

  const f = new FF(path.join(dir, 'fifo'))

  f.write(Buffer.from('a'))
  f.write(Buffer.from('b'))
  f.end()

  await new Promise((resolve) => f.on('finish', resolve))
  f.destroy()
  await new Promise((resolve) => f.on('close', resolve))

  const buf = await fs.promises.readFile(path.join(dir, 'fifo'))
  buf[buf.length - 1]++
  await fs.promises.writeFile(path.join(dir, 'fifo'), buf)

  const f2 = new FF(path.join(dir, 'fifo'))

  let recv = 0
  let last = null

  try {
    for await (const data of f2) {
      recv++
      last = data
      if (recv === 1) {
        setTimeout(() => f2.destroy(), 2000)
      }
    }
  } catch {
    // ignore
  }

  t.is(recv, 1)
  t.is(last.toString(), 'a')
})

test('destroy while a watcher-triggered read is in flight', async function (t) {
  const dir = await tmp(t)

  // a consumer drained the file, so the next write wakes the fs.watch read;
  // destroying right after that write races the read's own fs calls. The
  // delays and the two destroy shapes (immediate, and after end() finished
  // like a queue closing) cover the timing on both runtimes
  for (let i = 0; i < 300; i++) {
    const f = new FF(path.join(dir, 'fifo-' + i))
    f.on('readable', () => {
      let msg = f.read()
      while (msg !== null) msg = f.read()
    })
    f.write(Buffer.from('one'))
    await new Promise((resolve) => setTimeout(resolve, 3))
    f.write(Buffer.from('two'))
    if (i % 3 === 0) await new Promise((resolve) => setImmediate(resolve))
    else await new Promise((resolve) => setTimeout(resolve, i % 3))
    f.end()
    if (i % 2 === 0) await new Promise((resolve) => f.once('finish', resolve))
    f.destroy()
    await new Promise((resolve) => f.once('close', resolve))
  }

  t.pass('destroy never threw')
})
