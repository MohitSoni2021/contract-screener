import Brand from './Brand'
import type { User } from '../types'

type WorkspaceHeaderProps = {
  user: User
  onLogout: () => void
}

function WorkspaceHeader({ user, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="topbar">
      <Brand home />
      <div className="topbar-note"><span className="status-dot" /> Private document workspace</div>
      <button className="account-button" onClick={onLogout} title="Sign out">
        <span className="avatar">{user.name.trim().charAt(0).toUpperCase() || 'U'}</span>
        <span className="account-name">{user.name}</span>
        <span className="signout-label">Sign out</span>
      </button>
    </header>
  )
}

export default WorkspaceHeader
