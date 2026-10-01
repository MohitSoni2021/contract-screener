export type User = {
  id: string
  name: string
  email: string
}

export type AuthSession = {
  access_token: string
  token_type: 'bearer'
  user: User
}

export type UploadedDocument = {
  document_id: string
  filename: string
  status: string
}
