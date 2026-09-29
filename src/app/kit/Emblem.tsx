import emblem450 from '../../assets/brand/emblem-450.webp'
import emblem900Png from '../../assets/brand/emblem-900.png'
import emblem900Webp from '../../assets/brand/emblem-900.webp'

// The chain-bridge emblem (D21): about 300 px wide on Welcome, about 150 px on Log in and Enter
// the code. The emblem's "BCPS" letters are part of the image, so its alt text is "BCPS".
// Everywhere else the wordmark with the green square is used.

const RATIO = 338 / 900

export function Emblem({ size = 'welcome', className = '' }: { size?: 'welcome' | 'small'; className?: string }) {
  const width = size === 'welcome' ? 300 : 150
  const height = Math.round(width * RATIO)
  if (size === 'small') {
    return <img src={emblem450} alt="BCPS" width={width} height={height} className={`mx-auto block ${className}`} />
  }
  return (
    <picture>
      <source srcSet={emblem900Webp} type="image/webp" />
      <img src={emblem900Png} alt="BCPS" width={width} height={height} className={`mx-auto block ${className}`} />
    </picture>
  )
}
