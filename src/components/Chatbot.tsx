import { useState, useEffect, useRef } from 'react'
import { useTransformers } from '@huggingface/transformers'

interface ChatbotProps {
  onClose: () => void
}

export const Chatbot = ({ onClose }: ChatbotProps) => {
  const { pipeline, isLoading } = useTransformers('question-answering')
  const [messages, setMessages] = useState<{ text: string; isUser: boolean }[]>([
    { text: '¡Hola! ¿En qué puedo ayudarte con tu viaje?', isUser: false }
  ])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim()) return

    const userMessage = { text: input, isUser: true }
    setMessages(prev => [...prev, userMessage])
    setInput('')

    try {
      const botResponse = { text: 'Estoy procesando tu pregunta...', isUser: false }
      setMessages(prev => [...prev, botResponse])

      // Simulate AI response
      setTimeout(() => {
        setMessages(prev => [
          ...prev.slice(0, -1),
          { text: `Claro, aquí tienes información sobre "${input}":\n\nPuedes visitar este lugar en tu ruta. ¿Necesitas más detalles?`, isUser: false }
        ])
      }, 1000)
    } catch (error) {
      setMessages(prev => [
        ...prev,
        { text: 'Lo siento, no pude procesar tu pregunta. Inténtalo de nuevo.', isUser: false }
      ])
    }
  }

  return (
    <div className="chatbot-open fixed bottom-20 right-4 w-64 h-96 rounded-lg p-4 bg-white shadow-xl border border-gray-200 z-50 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg">Asistente de GuiAgo</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar mb-4 space-y-3">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs px-4 py-2 rounded-lg ${msg.isUser ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              {msg.text.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 input"
          placeholder={language === 'es' ? 'Escribe tu pregunta...' : 'Type your question...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        />
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
        >
          {isLoading ? '...' : '➤'}
        </button>
      </div>
    </div>
  )
}