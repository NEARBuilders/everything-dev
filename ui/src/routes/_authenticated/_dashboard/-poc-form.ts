/**
 * The POC's form state: TanStack Form fields that persist to localStorage per
 * organization, so a refresh restores the draft. Server-side prefill (the
 * admin-assigned pool, the org's default name) seeds values only while the
 * corresponding field is still untouched.
 */

import { useForm, useSelector } from "@tanstack/react-form";
import { useEffect, useRef } from "react";
import type { VoteOption } from "./-poc-chain";
import type { LensId } from "./-poc-stations";

export interface PocFormValues {
  name: string;
  pool: string;
  endowmentLinked: boolean;
  endowment: string;
  sponsorAmount: string;
  voteOption: VoteOption;
  govProposalId: string;
  lens: LensId;
}

export const POC_FORM_DEFAULTS: PocFormValues = {
  name: "",
  pool: "",
  endowmentLinked: false,
  endowment: "",
  sponsorAmount: "300000",
  voteOption: "For",
  govProposalId: "",
  lens: "you",
};

const STORAGE_PREFIX = "poc-form-v2:";

export function pocFormStorageKey(orgId: string): string {
  return STORAGE_PREFIX + orgId;
}

export function loadPocFormDraft(orgId: string | null): Partial<PocFormValues> | null {
  if (!orgId) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + orgId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PocFormValues>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function buildPocFormValues(
  orgId: string | null,
  prefill: Partial<PocFormValues> = {},
): PocFormValues {
  return {
    ...POC_FORM_DEFAULTS,
    ...prefill,
    ...loadPocFormDraft(orgId),
  };
}

export function usePocForm(orgId: string | null, initialValues: PocFormValues) {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async () => {},
  });

  const values = useSelector(form.store, (state) => state.values);

  /**
   * The first run after an organization change must not save: the values on
   * screen still belong to the previous organization, and writing them now
   * would clobber this organization's stored draft before the reset effect
   * has had a chance to load it.
   */
  const savedOrgId = useRef<string | null>(orgId);

  useEffect(() => {
    if (savedOrgId.current !== orgId) {
      savedOrgId.current = orgId;
      return;
    }
    if (!orgId) return;
    try {
      localStorage.setItem(pocFormStorageKey(orgId), JSON.stringify(values));
    } catch {}
  }, [orgId, values]);

  return form;
}

export function usePocFormValues(form: PocForm) {
  return useSelector(form.store, (state) => state.values);
}

export type PocForm = ReturnType<typeof usePocForm>;

/** Seeds a prefill value without clobbering what the user already entered. */
export function prefillIfEmpty(form: PocForm, field: keyof PocFormValues, value: string) {
  if (!value) return;
  if (form.getFieldValue(field)) return;
  form.setFieldValue(field, value);
}
