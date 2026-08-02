'use client';

import { create } from 'zustand';
import type { Plan } from './types';

/**
 * AI 에이전트에게 "이 항목에 대해" 라고 범위를 좁혀 요청하기 위한 선택 상태.
 * 각 산출물 화면에서 항목을 고르면 채팅 입력창 위에 그 항목이 표시된다.
 */
export interface SelectedItem {
  kind: '요구사항' | '기능' | '상세명세' | '화면' | '플로우' | '와이어프레임';
  id: string;
  label: string;
}

interface SelectionState {
  selected: SelectedItem | null;
  setSelected: (item: SelectedItem | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: null,
  setSelected: (item) => set({ selected: item }),
}));

/** 드롭다운에 채울 전체 항목 목록. */
export function selectableItems(plan: Plan): SelectedItem[] {
  return [
    ...plan.requirements.map<SelectedItem>((r) => ({
      kind: '요구사항',
      id: r.id,
      label: r.title,
    })),
    ...plan.features.map<SelectedItem>((f) => ({ kind: '기능', id: f.id, label: f.name })),
    ...plan.specifications.map<SelectedItem>((s) => ({
      kind: '상세명세',
      id: s.id,
      label: s.title,
    })),
    ...plan.iaPages.map<SelectedItem>((p) => ({ kind: '화면', id: p.id, label: p.name })),
    ...plan.flows.map<SelectedItem>((f) => ({ kind: '플로우', id: f.id, label: f.name })),
    ...plan.wireframes.map<SelectedItem>((w) => ({
      kind: '와이어프레임',
      id: w.id,
      label: w.name,
    })),
  ];
}
