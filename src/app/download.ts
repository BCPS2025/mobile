// Hands a text file to the browser's download: a Blob behind an `<a download>` that is clicked
// once. The page never leaves, nothing is sent anywhere, and the object URL is released a little
// later (a browser needs it for as long as it starts the save).

/** Saves `text` as a file called `fileName`. */
export function saveTextFile(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
