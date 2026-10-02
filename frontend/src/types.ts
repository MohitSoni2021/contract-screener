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
  created_at?: string
}

export type ComparisonSource = { document_id: string; text: string; block_number: number; page_number?: number | null }
export type ComparisonChange = { change_id: string; change_type: 'unchanged' | 'substantive' | 'wording' | 'formatting' | 'inserted' | 'deleted' | 'moved'; significance: 'none' | 'substantive' | 'wording' | 'formatting'; summary: string; old: ComparisonSource | null; new: ComparisonSource | null }

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
  coverage?: ChatCoverage
  created_at?: string
}

export type ChatCoverage = {
  mode: 'focused' | 'broad' | 'contents'
  complete: boolean
  source_count: number
  total_chunks?: number
  verified_chunks?: number
  covered_chunks?: number
  sections?: number
  page_ranges?: number
}

export type ChatConversation = {
  conversation_id: string
  title: string
  created_at: string
  updated_at: string
}
