import { SuiteShell } from "../../components/Suite";
export const metadata = { title: "Access Center", robots: { index: false } };
export default function AccessLayout({ children }) {
  return <SuiteShell>{children}</SuiteShell>;
}
