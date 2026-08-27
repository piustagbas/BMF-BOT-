import React, { createContext, useContext, useMemo, useState } from 'react';
import type { BetBookmaker, BetSlipSelection } from '../api/client';

type Ctx = {
  selections: BetSlipSelection[];
  bookmaker: BetBookmaker;
  setBookmaker: (b: BetBookmaker) => void;
  add: (row: BetSlipSelection) => void;
  replaceAll: (rows: BetSlipSelection[]) => void;
  remove: (fixtureId: string, market: string) => void;
  clear: () => void;
};

const SlipCtx = createContext<Ctx | null>(null);

export function BetSlipProvider({ children }: { children: React.ReactNode }) {
  const [selections, setSelections] = useState<BetSlipSelection[]>([]);
  const [bookmaker, setBookmaker] = useState<BetBookmaker>('bet9ja');

  const value = useMemo<Ctx>(
    () => ({
      selections,
      bookmaker,
      setBookmaker,
      add: (row) =>
        setSelections((prev) => {
          const next = prev.filter(
            (s) => !(s.fixtureId === row.fixtureId && s.market === row.market),
          );
          return [...next, row];
        }),
      replaceAll: (rows) => setSelections(rows),
      remove: (fixtureId, market) =>
        setSelections((prev) =>
          prev.filter((s) => !(s.fixtureId === fixtureId && s.market === market)),
        ),
      clear: () => setSelections([]),
    }),
    [selections, bookmaker],
  );

  return <SlipCtx.Provider value={value}>{children}</SlipCtx.Provider>;
}

export function useBetSlip() {
  const ctx = useContext(SlipCtx);
  if (!ctx) throw new Error('useBetSlip outside BetSlipProvider');
  return ctx;
}
