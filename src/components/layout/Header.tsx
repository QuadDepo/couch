import { TextAttributes } from '@opentui/core'

type Section = 'devices' | 'dpad'

interface HeaderProps {
  focusedSection: Section
}

const sectionLabels: Record<Section, string> = {
  devices: 'DEVICES',
  dpad: 'D-PAD',
}

export function Header({ focusedSection }: HeaderProps) {
  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor="#444444"
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>COUCH</text>
        <text fg="#666666"> - Smart TV Remote</text>
      </box>
      <box flexDirection="row">
        <text fg="#666666">[Tab] Switch | Focus: </text>
        <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
          {sectionLabels[focusedSection]}
        </text>
      </box>
    </box>
  )
}
