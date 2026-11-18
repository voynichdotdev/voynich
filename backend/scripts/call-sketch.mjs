// One paid call to sketch-32 from Node, as an outside developer makes it:
//   VOYNICH_API_URL=http://127.0.0.1:9702 VOYNICH_KEYPAIR=./caller.json node scripts/call-sketch.mjs
// The drawing is a clock face: a circle with two hands.
import voynich from 'voynich'

const drawing = Array.from({ length: 784 }, (_, index) => {
  const x = (index % 28) - 13.5, y = Math.floor(index / 28) - 13.5
  const rim = Math.abs(Math.hypot(x, y) - 10) < 0.85
  const hour = Math.abs(x) < 0.7 && y >= -7 && y <= 0
  const minute = x >= 0 && x <= 5 && Math.abs(y - x * 0.5) < 0.7
  return rim || hour || minute ? 1 : 0
})

const { output, receipt, verified } = await voynich.call('sketch-32', drawing)
console.log(JSON.stringify({ output, receipt: receipt.address, verified }, null, 2))
