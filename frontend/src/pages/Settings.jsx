import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import GeneralTab from '@/components/settings/GeneralTab.jsx'
import AppearanceTab from '@/components/settings/AppearanceTab.jsx'
import TaxonomyTab from '@/components/settings/TaxonomyTab.jsx'
import FoldersTab from '@/components/settings/FoldersTab.jsx'
import AccountsTab from '@/components/settings/AccountsTab.jsx'
import DataTab from '@/components/settings/DataTab.jsx'
import { useAuth } from '@/context/AuthContext.jsx'
import AgentTab from '@/components/settings/AgentTab.jsx'

const ALL_TABS = [
  { value: 'general', label: 'General', Component: GeneralTab },
  { value: 'appearance', label: 'Appearance', Component: AppearanceTab },
  { value: 'taxonomy', label: 'Taxonomy', Component: TaxonomyTab },
  { value: 'folders', label: 'Folders', Component: FoldersTab },
  { value: 'data', label: 'Data', Component: DataTab, adminOnly: true },
  { value: 'agent', label: 'Agent API', Component: AgentTab },
  { value: 'accounts', label: 'Accounts', Component: AccountsTab },
]

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const { isAdmin } = useAuth()
  const TABS = ALL_TABS.filter((t) => !t.adminOnly || isAdmin)
  const current = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'general'
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-4 text-lg font-semibold">Settings</h1>
      <Tabs value={current} onValueChange={(v) => setParams(v === 'general' ? {} : { tab: v }, { replace: true })}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        {TABS.map(({ value, Component }) => (
          <TabsContent key={value} value={value} className="mt-2"><Component /></TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
