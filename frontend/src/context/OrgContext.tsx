import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { Org, OrgMember } from "../types";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

interface OrgContextValue {
  orgs: Org[];
  activeOrg: Org | null;
  members: OrgMember[];
  switchOrg: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  createOrg: (name: string) => Promise<Org>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

const ACTIVE_ORG_KEY = "aura-active-org";

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);

  const refreshOrgs = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api.orgs.list();
      setOrgs(list);

      const savedId = localStorage.getItem(ACTIVE_ORG_KEY);
      const match = list.find((o) => o.org_id === savedId);
      const selected = match ?? list[0] ?? null;
      setActiveOrg(selected);

      if (selected) {
        localStorage.setItem(ACTIVE_ORG_KEY, selected.org_id);
      }
    } catch (err) {
      console.error("Failed to load orgs", err);
    }
  }, [user]);

  const refreshMembers = useCallback(async () => {
    if (!activeOrg) {
      setMembers([]);
      return;
    }
    try {
      const m = await api.orgs.listMembers(activeOrg.org_id);
      setMembers(m);
    } catch (err) {
      console.error("Failed to load members", err);
    }
  }, [activeOrg]);

  useEffect(() => {
    refreshOrgs();
  }, [refreshOrgs]);

  useEffect(() => {
    refreshMembers();
  }, [refreshMembers]);

  const switchOrg = useCallback(
    (orgId: string) => {
      const org = orgs.find((o) => o.org_id === orgId);
      if (org) {
        setActiveOrg(org);
        localStorage.setItem(ACTIVE_ORG_KEY, orgId);
      }
    },
    [orgs],
  );

  const createOrg = useCallback(
    async (name: string) => {
      const org = await api.orgs.create(name);
      await refreshOrgs();
      return org;
    },
    [refreshOrgs],
  );

  return (
    <OrgContext.Provider
      value={{ orgs, activeOrg, members, switchOrg, refreshOrgs, refreshMembers, createOrg }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return ctx;
}
