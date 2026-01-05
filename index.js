const { Duplex } = require('streamx')
const fs = require('fs')
const { crc32 } = require('crc-universal')
const fsext = require('fs-native-extensions')
const onexit = require('resource-on-exit')

const RANDOM_ACCESS_APPEND = fs.constants.O_RDWR | fs.constants.O_CREAT

module.exports = class FIFOFile extends Duplex {
  constructor(filename, { valueEncoding, maxSize = 16 * 1024 * 1024 } = {}) {
    const mapWritable = valueEncoding ? createMapWritable(valueEncoding) : defaultMapWritable
    const mapReadable = valueEncoding ? createMapReadable(valueEncoding) : null

    super({ highWaterMark: 0, mapWritable, mapReadable })

    this.filename = filename
    this.fd = 0
    this.maxSize = maxSize

    this._pos = 0
    this._watcher = null
    this._locked = null
  }

  _open(cb) {
    fs.open(this.filename, RANDOM_ACCESS_APPEND, (err, fd) => {
      if (err) return cb(err)
      this.fd = fd
      onexit.add(this, closeSync)
      cb(null)
    })
  }

  _writev(batch, cb) {
    this._lock((err, free) => {
      if (err) return free(cb, err)
      writeMessages(this.fd, batch, (err) => {
        free(cb, err)
      })
    })
  }

  _lock(cb) {
    if (this._locked !== null) {
      this._locked.push(cb)
      return
    }

    this._locked = []
    this._runLocked(cb)
  }

  _runLocked(cb) {
    const free = (cb, err) => {
      fsext.unlock(this.fd)

      if (this._locked !== null) {
        if (err) {
          while (this._locked.length > 0) this._locked.pop()(err, dummyFree)
        } else if (this._locked.length === 0) {
          this._locked = null
        } else {
          this._runLocked(this._locked.shift())
        }
      }

      cb(err)
    }

    waitForLock(this.fd, (err) => {
      if (err) return cb(err, null)
      if (this.destroying) return cb(new Error('Destroyed'), dummyFree)
      cb(null, free)
    })
  }

  _waitAndRead() {
    this._watcher = fs.watch(this.filename, () => {
      this._watcher.close()
      this._watcher = null
      this._read((err) => {
        if (err) this.destroy(err)
      })
    })
  }

  _read(cb) {
    this._lock((err, free) => {
      if (err) return free(cb, err)

      readMessages(this.fd, this.maxSize, this._pos, (err, batch, pos) => {
        if (err) return free(cb, err)

        this._pos = pos

        for (const msg of batch) this.push(msg)

        if (!batch.length) {
          this._waitAndRead()
        }

        free(cb, null)
      })
    })
  }

  _predestroy() {
    if (this._watcher) this._watcher.close()
    this._watcher = null
    if (this._locked !== null && this._locked.length > 0) {
      while (this._locked.length > 0) this._locked.pop()(new Error('Destroying'))
    }
  }

  _destroy(cb) {
    if (this.fd === 0) {
      cb(null)
      return
    }

    onexit.remove(this, closeSync)
    fs.close(this.fd, () => {
      this.fd = 0
      cb(null)
    })
  }
}

function waitForLock(fd, cb) {
  fsext.waitForLock(fd).then(cb, cb)
}

function writeMessages(fd, batch, cb) {
  let offset = 0

  let len = 0
  for (const msg of batch) len += msg.byteLength + 4 + 4

  const buf = Buffer.allocUnsafe(len)

  len = 0
  for (const msg of batch) {
    buf.writeUInt32LE(msg.byteLength, len)
    len += 4
    buf.writeUInt32LE(crc32(msg), len)
    len += 4
    buf.set(msg, len)
    len += msg.byteLength
  }

  fs.fstat(fd, function (err, st) {
    if (err) return cb(err)

    let pos = st.size
    fs.write(fd, buf, 0, buf.byteLength, pos, loop)

    function loop(err, wrote) {
      if (err) return cb(err)
      if (wrote === 0) return cb(null)
      offset += wrote
      pos += wrote
      if (offset === buf.byteLength) return cb(null)
      fs.write(fd, buf, offset, buf.byteLength - offset, pos, loop)
    }
  })
}

function readMessages(fd, maxSize, pos, cb) {
  let start = 0
  let end = 0
  let buf = Buffer.allocUnsafe(65536)

  const batch = []

  fs.read(fd, buf, 0, buf.byteLength, pos, loop)

  function ontruncate(err) {
    if (err) return cb(err)
    cb(null, batch, 0)
  }

  function loop(err, read) {
    if (err) return cb(err)

    if (read === 0) {
      fs.ftruncate(fd, 0, ontruncate)
      return
    }

    end += read

    while (end - start >= 8) {
      const size = buf.readUInt32LE(start)

      if (size > maxSize) {
        fs.ftruncate(fd, 0, ontruncate)
        return
      }

      if (start + 8 + size > end) {
        while (start + 8 + size > buf.byteLength) {
          buf = Buffer.concat([buf, Buffer.allocUnsafe(buf.byteLength)])
        }
        break
      }

      start += 4
      const chk = buf.readUInt32LE(start)
      start += 4
      const msg = buf.subarray(start, start + size)
      start += size

      if (crc32(msg) !== chk) {
        fs.ftruncate(fd, 0, ontruncate)
        return
      }

      batch.push(msg)
    }

    if (end >= buf.byteLength / 2 && batch.length > 0) return cb(null, batch, pos + start)

    fs.read(fd, buf, end, buf.byteLength - end, pos + end, loop)
  }
}

function defaultMapWritable(buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}

function createMapWritable(valueEncoding) {
  return function (data) {
    const state = { start: 0, end: 0, buffer: null }
    valueEncoding.preencode(state, data)
    state.buffer = Buffer.allocUnsafe(state.end)
    valueEncoding.encode(state, data)
    return state.buffer
  }
}

function createMapReadable(valueEncoding) {
  return function (buffer) {
    return valueEncoding.decode({ start: 0, end: buffer.byteLength, buffer })
  }
}

function dummyFree(cb, err) {
  cb(err)
}

function closeSync(fifo) {
  if (fifo.fd <= 0) return
  const fd = fifo.fd
  fifo.fd = 0
  fs.closeSync(fd)
}
