import React from 'react'
import { RiMoonLine, RiSunLine, RiComputerLine } from '@remixicon/react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { useTheme } from '@/context/ThemeContext.jsx'

const options = [
  { value: 'light', label: 'Light', icon: RiSunLine },
  { value: 'dark', label: 'Dark', icon: RiMoonLine },
  { value: 'system', label: 'System', icon: RiComputerLine },
]

export default function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>System follows your operating system setting.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup variant="outline" value={[theme]} aria-label="Theme"
          onValueChange={(v) => { if (v[0]) setTheme(v[0]) }}>
          {options.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value}><Icon /> {label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}
