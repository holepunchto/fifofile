# fifofile

Userland FIFO file.

```
npm install filefile
```

## Usage

To consume, in any process

```js
const FIFOFile = require('filefile')

for await (const msg of new FIFOFile('/tmp/my-fifo')) {
  console.log('incoming:', msg)
}
```

To produce, in any process

```js
const FIFOFile = require('filefile')

const fifo = new FIFOFile('/tmp/my-fifo')

fifo.write(Buffer.from('a msg'))
```

## License

Apache-2.0
