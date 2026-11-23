export const Counter = () => {
    let currentCount = 0
    let startTime = 0
    let endTime = 0
  
    setInterval(() => {
      endTime = new Date().getTime()
      const ellapsed = endTime - startTime
      const nbPerSec = 1000*currentCount / ellapsed
      console.log("Speed: " + nbPerSec + " message/sec")
      currentCount = 0
      startTime = new Date().getTime()
    }, 500)
  
    return {
      incrementCount: () => {
        currentCount++
      }
    }
  }