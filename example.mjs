import FIFOFile from './index.js'

const argv = global.Bare ? global.Bare.argv : global.process.argv
const fifo = new FIFOFile('/tmp/fifo')

if (argv[2] === 'read') {
  fifo.on('data', function (data) {
    console.log('got:', JSON.parse(data.toString()))
  })
}

if (argv[2] === 'write') {
  fifo.end(Buffer.from(JSON.stringify({ hello: 'world', time: Date.now() })))
}
