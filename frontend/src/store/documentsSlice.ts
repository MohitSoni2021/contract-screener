import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { UploadedDocument } from '../types'

export type DocumentsState = {
  items: UploadedDocument[]
  loading: boolean
  error: string
  busy: boolean
  removingId: string | null
  loadedToken: string | null
}

type ApiResponse = {
  detail?: string
  document?: UploadedDocument | null
  documents?: UploadedDocument[]
}

type RequestArgs = { token: string; documentId?: string; file?: File }

const initialState: DocumentsState = {
  items: [],
  loading: false,
  error: '',
  busy: false,
  removingId: null,
  loadedToken: null,
}

const PROCESSING_STATUSES = new Set(['extracting', 'chunking', 'embedding', 'indexing'])

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function request(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  if (response.status === 204) return null
  const body = await response.text()
  let result: ApiResponse = {}
  if (body) {
    try { result = JSON.parse(body) as ApiResponse } catch { /* Some proxies return plain-text errors. */ }
  }
  if (!response.ok) throw new Error(result.detail ?? (body || 'The request could not be completed.'))
  return result
}

export const fetchDocuments = createAsyncThunk('documents/fetchAll', async ({ token }: RequestArgs) => {
  const result = await request('/api/documents', token)
  return { documents: result?.documents ?? [], token }
}, {
  condition: ({ token }, { getState }) => {
    const state = getState() as { documents: DocumentsState }
    return state.documents.loadedToken !== token && !state.documents.loading
  },
})

export const fetchDocument = createAsyncThunk('documents/fetchOne', async ({ token, documentId }: RequestArgs) => {
  const result = await request(`/api/documents/${documentId}`, token)
  return result as unknown as UploadedDocument
})

export const uploadDocument = createAsyncThunk('documents/upload', async ({ token, file }: RequestArgs) => {
  const body = new FormData()
  body.append('file', file!)
  const result = await request('/api/documents', token, { method: 'POST', body })
  return result as unknown as UploadedDocument
})

export const removeDocument = createAsyncThunk('documents/remove', async ({ token, documentId }: RequestArgs) => {
  let document = await request(`/api/documents/${documentId}`, token) as unknown as UploadedDocument
  while (PROCESSING_STATUSES.has(document.status)) {
    await wait(1500)
    document = await request(`/api/documents/${documentId}`, token) as unknown as UploadedDocument
  }
  await request(`/api/documents/${documentId}`, token, { method: 'DELETE' })
  return documentId!
})

export const refreshDocument = createAsyncThunk('documents/refreshOne', async ({ token, documentId }: RequestArgs) => {
  const result = await request(`/api/documents/${documentId}`, token)
  return result as unknown as UploadedDocument
})

const documentsSlice = createSlice({
  name: 'documents',
  initialState,
  reducers: {
    clearDocumentState: () => initialState,
    clearDocumentError: (state) => { state.error = '' },
    setDocumentError: (state, action: PayloadAction<string>) => { state.error = action.payload },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDocuments.pending, (state) => { state.loading = true; state.error = '' })
      .addCase(fetchDocuments.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.documents
        state.loadedToken = action.payload.token
      })
      .addCase(fetchDocuments.rejected, (state, action) => {
        state.loading = false
        if (action.error.name !== 'ConditionError') state.error = action.error.message ?? 'Could not load your documents.'
      })
      .addCase(fetchDocument.fulfilled, (state, action: PayloadAction<UploadedDocument>) => {
        const index = state.items.findIndex((item) => item.document_id === action.payload.document_id)
        if (index === -1) state.items.unshift(action.payload)
        else state.items[index] = action.payload
      })
      .addCase(fetchDocument.rejected, (state, action) => { state.error = action.error.message ?? 'Could not load this document.' })
      .addCase(refreshDocument.fulfilled, (state, action: PayloadAction<UploadedDocument>) => {
        const index = state.items.findIndex((item) => item.document_id === action.payload.document_id)
        if (index !== -1) state.items[index] = action.payload
      })
      .addCase(uploadDocument.pending, (state) => { state.busy = true; state.error = '' })
      .addCase(uploadDocument.fulfilled, (state, action: PayloadAction<UploadedDocument>) => {
        state.busy = false
        state.items.unshift(action.payload)
      })
      .addCase(uploadDocument.rejected, (state, action) => { state.busy = false; state.error = action.error.message ?? 'Could not reach the API.' })
      .addCase(removeDocument.pending, (state, action) => { state.removingId = action.meta.arg.documentId ?? null; state.error = '' })
      .addCase(removeDocument.fulfilled, (state, action: PayloadAction<string>) => {
        state.removingId = null
        state.items = state.items.filter((item) => item.document_id !== action.payload)
      })
      .addCase(removeDocument.rejected, (state, action) => { state.removingId = null; state.error = action.error.message ?? 'Could not remove this document.' })
  },
})

export const { clearDocumentState, clearDocumentError, setDocumentError } = documentsSlice.actions
export default documentsSlice.reducer
