interface LogoIconProps {
  size?: number;
}

export function LogoIcon({ size = 32 }: LogoIconProps) {
  return <img src="/logo.svg" alt="IO" width={size} height={size} />;
}
