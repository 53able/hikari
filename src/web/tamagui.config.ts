import { createTamagui, createFont, createTokens } from '@tamagui/core';

const tokens = createTokens({
  color: {
    background: '#f5f5f5',
    panelBg: '#ffffff',
    headerBg: '#1a1a2e',
    headerColor: '#ffffff',
    border: '#e0e0e0',
    text: '#333333',
    userBg: '#1a1a2e',
    userColor: '#ffffff',
    assistantBg: '#ffffff',
    toolBg: '#f0f7ff',
    toolBorder: '#b3d4f0',
    errorBg: '#fff0f0',
    errorColor: '#cc0000',
    approvalBg: '#fff8e6',
    approvalBorder: '#e6c200',
    approveBtn: '#1a7f37',
    rejectBtn: '#cc0000',
  },
  space: {
    1: 8,
    2: 12,
    3: 16,
  },
  size: {
    1: 8,
    2: 12,
    3: 16,
  },
  radius: {
    1: 6,
    2: 8,
    3: 12,
  },
});

const bodyFont = createFont({
  family: 'system-ui, sans-serif',
  size: {
    1: 12,
    2: 14,
    3: 16,
  },
  lineHeight: {
    1: 16,
    2: 20,
    3: 22,
  },
  weight: {
    4: '400',
    6: '600',
  },
});

const config = createTamagui({
  tokens,
  themes: {
    light: {
      background: tokens.color.background,
      panelBg: tokens.color.panelBg,
      headerBg: tokens.color.headerBg,
      headerColor: tokens.color.headerColor,
      border: tokens.color.border,
      color: tokens.color.text,
    },
  },
  fonts: {
    body: bodyFont,
    heading: bodyFont,
  },
  settings: {
    disableSSR: true,
  },
});

export type AppTamaguiConfig = typeof config;

declare module '@tamagui/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default config;
