import { Link } from 'react-router-dom'

type BrandProps = {
  to?: string
  home?: boolean
}

function Brand({ to = '/', home = false }: BrandProps) {
  return (
    <Link className="brand" to={to} aria-label={home ? 'Elcara home' : 'Elcara'}>
      <span className="brand-mark">e</span>elcara
    </Link>
  )
}

export default Brand
