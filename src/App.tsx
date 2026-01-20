import { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import type { TVDevice, RemoteKey } from './types/index.ts'
import { Header } from './components/layout/Header.tsx'
import { StatusBar } from './components/layout/StatusBar.tsx'
import { DeviceList } from './components/devices/DeviceList.tsx'
import { DPad } from './components/controls/DPad.tsx'

const SECTIONS = ['devices', 'dpad'] as const

type Section = typeof SECTIONS[number]

const mockDevices: TVDevice[] = [
  { id: '1', name: 'Living Room LG', platform: 'lg-webos', ip: '192.168.1.42', status: 'connected' },
  { id: '2', name: 'Bedroom Samsung', platform: 'samsung-tizen', ip: '192.168.1.43', status: 'disconnected' },
  { id: '3', name: 'Kitchen Philips', platform: 'titan-os', ip: '192.168.1.44', status: 'disconnected' },
]

export function App() {
  const [devices] = useState<TVDevice[]>(mockDevices)
  const [activeDevice, setActiveDevice] = useState<TVDevice | null>(mockDevices[0] ?? null)
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0)
  const [focusedSection, setFocusedSection] = useState<Section>('dpad')

  const cycleSection = (reverse: boolean = false) => {
    const currentIndex = SECTIONS.indexOf(focusedSection)
    const nextIndex = reverse
      ? (currentIndex - 1 + SECTIONS.length) % SECTIONS.length
      : (currentIndex + 1) % SECTIONS.length
    setFocusedSection(SECTIONS[nextIndex]!)
  }

  useKeyboard((event) => {
    if (event.name === 'tab') {
      cycleSection(event.shift)
    }
  })

  const handleCommand = (key: RemoteKey) => {
    if (!activeDevice || activeDevice.status !== 'connected') return
    // TODO: Implement actual TV command sending
    console.log(`Sending ${key} to ${activeDevice.name}`)
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header focusedSection={focusedSection} />

      <box flexDirection="row" flexGrow={1} gap={1}>
        <DeviceList
          devices={devices}
          activeDevice={activeDevice}
          selectedIndex={selectedDeviceIndex}
          focused={focusedSection === 'devices'}
          onSelectedIndexChange={setSelectedDeviceIndex}
          onSelect={setActiveDevice}
        />

        <DPad
          enabled={activeDevice?.status === 'connected'}
          focused={focusedSection === 'dpad'}
          onCommand={handleCommand}
        />
      </box>

      <StatusBar device={activeDevice} />
    </box>
  )
}
