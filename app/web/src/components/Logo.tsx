// SPI Américas logo: blue on light backgrounds, white in dark mode.
export default function Logo({ alto = 28, blanco = false }: { alto?: number; blanco?: boolean }) {
  return (
    <picture>
      {blanco ? null : <source srcSet="/logo-spi-blanco.png" media="(prefers-color-scheme: dark)" />}
      <img src={blanco ? '/logo-spi-blanco.png' : '/logo-spi.png'} alt="SPI Américas" height={alto} style={{ height: alto, width: 'auto', display: 'block' }} />
    </picture>
  )
}
