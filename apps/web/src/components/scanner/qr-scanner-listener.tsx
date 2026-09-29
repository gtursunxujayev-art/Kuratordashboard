'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/toast';
import { QrScanResultPopup, type QrScanResult } from './qr-scan-result-popup';

// A hardware keyboard-wedge QR scanner "types" the scanned code as a fast burst of
// keystrokes followed by Enter. This listens globally (any page of the dashboard)
// so staff can check students in without navigating to a dedicated scan page.
const MIN_TOKEN_LENGTH = 8;
const MAX_INTER_KEY_GAP_MS = 50;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function QrScannerListener() {
  const toast = useToast();
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const [scanResult, setScanResult] = useState<QrScanResult | null>(null);

  const checkInMutation = trpc.clientBot.checkInByTicket.useMutation({
    onSuccess: (result) => {
      setScanResult(result as QrScanResult);
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
        if (token.length >= MIN_TOKEN_LENGTH) {
          // Stop the scanner's Enter from also clicking whatever button has focus.
          event.preventDefault();
          mutateRef.current({ token });
        }
        return;
      }

      if (event.key.length === 1) {
        // A slow key means a human typed it, so it can't be part of a scan burst —
        // start the buffer fresh from here instead of poisoning the next real scan.
        if (gap > MAX_INTER_KEY_GAP_MS) bufferRef.current = '';
        bufferRef.current += event.key;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!scanResult) return null;
  return <QrScanResultPopup result={scanResult} onClose={() => setScanResult(null)} />;
}
