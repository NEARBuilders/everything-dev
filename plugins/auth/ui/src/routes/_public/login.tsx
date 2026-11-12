import { WarningCircleIcon } from "@phosphor-icons/react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthPanel } from "@/components/auth-panel";
import { ErrorDetail } from "@/components/error-detail";
import { Button } from "@/components/ui/button";
import { LoginI18nProvider, useLoginTranslation } from "@/i18n/runtime";
import { siteErrorMessage } from "@/lib/site-error";
import "../../styles.css";

export const Route = createFileRoute("/_public/login")({
  ssr: false,
  component: LoginLayout,
  errorComponent: LoginErrorLayout,
});

function LoginLayout() {
  return <Outlet />;
}

function LoginErrorLayout(props: { error: unknown; reset: () => void }) {
  return (
    <LoginI18nProvider>
      <LoginErrorContent error={props.error} reset={props.reset} />
    </LoginI18nProvider>
  );
}

function LoginErrorContent({ error, reset }: { error: unknown; reset: () => void }) {
  const t = useLoginTranslation();
  const { message, detail } = siteErrorMessage(error, t("auth.error.pageFailed"));
  return (
    <AuthPanel
      icon={<WarningCircleIcon />}
      title={t("auth.login.title")}
      titleTestId="login.error-heading"
    >
      <div className="flex flex-col items-center gap-4">
        <ErrorDetail message={message} detail={detail} testId="login.error" />
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => reset()}
          data-testid="login.error-retry"
        >
          {t("auth.error.retry")}
        </Button>
      </div>
    </AuthPanel>
  );
}
