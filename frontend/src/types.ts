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
  stage: string
  progress: number
  page_count?: number | null
  chunk_count?: number | null
  indexed_chunks: number
  error?: string | null
}

export type ChatCitation = {
  source_id: string
  chunk_id: string
  quote: string
  page_start?: number | null
  page_end?: number | null
  block_start?: number | null
  block_end?: number | null
  char_start: number
  char_end: number
  verified: boolean
}

export type ChatMessage = {
  message_id: string
  role: 'user' | 'assistant'
  content: string
  status: 'complete' | 'streaming' | 'partial' | 'cancelled' | 'failed'
  citations: ChatCitation[]
  created_at?: string
}

export type ChatConversation = {
  conversation_id: string
  title: string
  created_at: string
  updated_at: string
}
