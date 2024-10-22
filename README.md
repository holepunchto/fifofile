# fifofile

Userland FIFO file.

```
npm install fifofile
```

## Usage

To consume, in any process

```js
const FIFOFile = require('fifofile')

for await (const msg of new FIFOFile('/tmp/my-fifo')) {
  console.log('incoming:', msg)
}
```

To produce, in any process

```js
const FIFOFile = require('fifofile')

const fifo = new FIFOFile('/tmp/my-fifo')

fifo.write(Buffer.from('a msg'))
```

## License

Apache-2.0
