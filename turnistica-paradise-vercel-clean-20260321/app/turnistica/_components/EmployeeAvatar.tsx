import type { CSSProperties } from "react";
import styles from "@/app/turnistica/_components/employee-avatar.module.css";
import { employeeInitials } from "@/app/turnistica/_lib/utils";

type Props = {
  fullName: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "print";
};

const GRADIENTS = [
  ["#d24a92", "#8e2f62"],
  ["#ba5679", "#5e233d"],
  ["#9450a5", "#4e295f"],
  ["#c45a88", "#6c2b4d"],
  ["#5d3856", "#2d1827"]
] as const;

function paletteFor(name: string) {
  const index = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0) % GRADIENTS.length;
  return GRADIENTS[index];
}

export function EmployeeAvatar({ fullName, photoUrl, size = "md" }: Props) {
  const [avatarStart, avatarEnd] = paletteFor(fullName);
  const initials = employeeInitials(fullName);
  const avatarStyle = {
    "--avatar-start": avatarStart,
    "--avatar-end": avatarEnd
  } as CSSProperties;

  return (
    <span className={`${styles.root} ${styles[size]}`} style={avatarStyle}>
      {photoUrl ? (
        <img className={styles.image} src={photoUrl} alt={fullName} loading="lazy" draggable={false} />
      ) : (
        <span className={styles.fallback}>{initials}</span>
      )}
    </span>
  );
}
