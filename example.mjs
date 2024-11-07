import FIFOFile from './index.js'
import c from 'compact-encoding'

const argv = global.Bare ? global.Bare.argv : global.process.argv
const fifo = new FIFOFile('/tmp/fifo', { valueEncoding: c.any })

if (argv[2] === 'read') {
  fifo.on('data', function (data) {
    console.log('got:', data)
  })
}

if (argv[2] === 'write') {
  fifo.end({ hello: 'world', time: Date.now() })
}
