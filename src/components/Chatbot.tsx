import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../stores/appStore'
import { chatWithAssistant, getAIKey } from '../services/ai'

interface ChatbotProps {
  onClose: () => void
}

export const Chatbot = ({ onClose }: ChatbotProps) => {
  const { language, anthropicApiKey } = useAppStore()
  const es = language === 'es'

  const [messages, setMessages] = useState<{ text: string; isUser: boolean }[]>([
    {
      text: es
        ? '¡Hola! Soy tu asistente de GuiAgo. Pregúntame sobre cualquier lugar turístico, qué visitar o consejos de viaje.'
        : 'Hi! I\'m your GuiAgo assistant. Ask me about any tourist spot, what to visit, or travel tips.',
      isUser: false,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { text, isUser: true }])
    setInput('')
    setLoading(true)

    const thinking = es ? 'Pensando…' : 'Thinking…'
    setMessages(prev => [...prev, { text: thinking, isUser: false }])

    try {
      const reply = await chatWithAssistant(text, language, getAIKey(anthropicApiKey))

      setMessages(prev => [
        ...prev.slice(0, -1),
        { text: reply || (es ? 'No pude obtener respuesta. Inténtalo de nuevo.' : 'Could not get a response. Please try again.'), isUser: false },
      ])
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { text: es ? 'Error al conectar con el asistente. Verifica tu conexión.' : 'Error connecting to assistant. Check your connection.', isUser: false },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-20 right-4 w-72 h-[420px] rounded-2xl bg-white shadow-2xl border border-stone-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-orange-500 text-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🗺️</span>
          <span className="font-semibold text-sm">
            {es ? 'Asistente GuiAgo' : 'GuiAgo Assistant'}
          </span>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-snug ${
              msg.isUser
                ? 'bg-orange-500 text-white rounded-br-sm'
                : 'bg-stone-100 text-stone-800 rounded-bl-sm'
            }`}>
              {msg.text.split('\n').map((line, i) => (
                <p key={i} className={i > 0 ? 'mt-1' : ''}>{line}</p>
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 px-3 py-3 border-t border-stone-100 shrink-0">
        <input
          type="text"
          className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          placeholder={es ? 'Escribe tu pregunta…' : 'Type your question…'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={loading}
        />
        <button
          className="w-9 h-9 bg-orange-500 text-white rounded-xl flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
          onClick={handleSend}
          disabled={!input.trim() || loading}
        >
          {loading
            ? <span className="text-xs">…</span>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
          }
        </button>
      </div>
    </div>
  )
}
