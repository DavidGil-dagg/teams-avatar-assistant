'use client';

import { useEffect, useRef } from 'react';

import { useBrand } from '@/components/brand-provider';
import type { CallMessage } from '@/lib/assistant/use-assistant-call';

export function Transcript({ messages }: { messages: CallMessage[] }) {
  const brand = useBrand();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <p className="transcript-empty">
        Aquí aparecerá la conversación. Puedes hablarle o escribirle.
      </p>
    );
  }

  return (
    <ol className="transcript" aria-label={`Conversación con ${brand.assistant.inSentence}`}>
      {messages.map((message) => (
        <li key={message.id} className="turn" data-role={message.role}>
          <span className="turn-who">{message.role === 'user' ? 'Tú' : brand.assistant.name}</span>
          {message.text ? (
            <p className="turn-text">{message.text}</p>
          ) : (
            <p className="turn-text turn-voice">Mensaje de voz</p>
          )}
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}
