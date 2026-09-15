'use client';

import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/toast';

// A hardware keyboard-wedge QR scanner "types" the scanned code as a fast burst of
// keystrokes followed by Enter. This listens globally (any page of the dashboard)
// so staff can check students in without navigating to a dedicated scan page.
const MIN_TOKEN_LENGTH = 8;
const MAX_INTER_KEY_GAP_MS = 50;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function QrScannerListener() {
  const toast = useToast();
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const gapOkRef = useRef(true);

  const checkInMutation = trpc.clientBot.checkInByTicket.useMutation({
    onSuccess: (result) => {
      const name = result.customerName ?? "O'quvchi";
      switch (result.status) {
        case 'marked':
          toast.show(`${name} — keldi`, 'success');
          break;
        case 'already_marked':
          toast.show(`${name} — allaqachon belgilangan`, 'info');
          break;
        case 'manual_mark_kept':
          toast.show(`${name} — qo'lda belgilangan holat saqlanadi`, 'info');
          break;
        case 'invalid_ticket':
          toast.show('QR chipta yaroqsiz', 'error');
          break;
        case 'not_class_day':
        case 'no_lesson':
          toast.show(`${name} — bugun bu oqim uchun dars kuni emas`, 'error');
          break;
        default:
          break;
      }
    },
    onError: (error) => {
      toast.show(error.message || 'QR skanerlashda xatolik', 'error');
    },
  });

  const mutateRef = useRef(checkInMutation.mutate);
  useEffect(() => {
    mutateRef.current = checkInMutation.mutate;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (event.key === 'Enter') {
        const token = bufferRef.current;
        bufferRef.current = '';
        const wasFastBurst = gapOkRef.current;
        gapOkRef.current = true;
        if (token.length >= MIN_TOKEN_LENGTH && wasFastBurst) {
          mutateRef.current({ token });
        }
        return;
      }

      if (event.key.length === 1) {
        if (bufferRef.current.length > 0 && gap > MAX_INTER_KEY_GAP_MS) {
          gapOkRef.current = false;
        }
        bufferRef.current += event.key;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
