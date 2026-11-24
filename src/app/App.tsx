import { useMemo, useState, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "@/app/store";
import { Notice } from "@/components/primitives";
import { BuyerCatalog } from "@/features/buyer/BuyerCatalog";
import { BuyerBasket } from "@/features/buyer/BuyerBasket";
import { BuyerLists } from "@/features/buyer/BuyerLists";
import { BuyerProcurement } from "@/features/buyer/BuyerProcurement";
import { BuyerProcurementDetail } from "@/features/buyer/BuyerProcurementDetail";
import { SupplierCockpit } from "@/features/supplier/SupplierCockpit";
import { OperatorCockpit } from "@/features/operator/OperatorCockpit";
import { AuditPage } from "@/features/operator/AuditPage";
import { NotificationsPage } from "@/features/buyer/NotificationsPage";
import { PersonaSwitcher } from "@/features/session/PersonaSwitcher";
import { isPlatformSide, isSupplierSide } from "@/domain/authorization";

function BuyerNav({ m }: { m: ReturnType<typeof useApp>["messages"] }): ReactNode {
  return (
    <>
      <NavLink to="/catalog" className="nav-link">
        {m.nav.catalog}
      </NavLink>
      <NavLink to="/basket" className="nav-link">
        {m.nav.basket}
      </NavLink>
      <NavLink to="/lists" className="nav-link">
        {m.nav.lists}
      </NavLink>
      <NavLink to="/procurement" className="nav-link">
        {m.nav.procurement}
      </NavLink>
      <NavLink to="/notifications" className="nav-link">
        {m.nav.notifications}
      </NavLink>
    </>
  );
}

function SupplierNav({ m }: { m: ReturnType<typeof useApp>["messages"] }): ReactNode {
  return (
    <NavLink to="/supplier" className="nav-link">
      {m.nav.supplier}
    </NavLink>
  );
}

function OperatorNav({ m }: { m: ReturnType<typeof useApp>["messages"] }): ReactNode {
  return (
    <>
      <NavLink to="/operator" className="nav-link">
        {m.nav.operator}
      </NavLink>
      <NavLink to="/operator/audit" className="nav-link">
        {m.nav.audit}
      </NavLink>
    </>
  );
}

function Home(): ReactNode {
  const { membership, messages } = useApp();
  return (
    <section className="card">
      <h2 className="card-title">{messages.app.title}</h2>
      <p>{messages.app.subtitle}</p>
      <p>
        Текущая демо-роль: <strong>{membership.displayName}</strong>. Это переключение
        демонстрационной персоны, а не реальная авторизация.
      </p>
    </section>
  );
}

export function App(): ReactNode {
  const { messages, membership } = useApp();
  const [navOpen, setNavOpen] = useState(false);

  const nav = useMemo(() => {
    if (isSupplierSide(membership)) return <SupplierNav m={messages} />;
    if (isPlatformSide(membership)) return <OperatorNav m={messages} />;
    return <BuyerNav m={messages} />;
  }, [membership, messages]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {messages.a11y.skipToContent}
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            H
          </span>
          <span className="brand-text">{messages.app.title}</span>
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="primary-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          Меню
        </button>
        <nav
          id="primary-nav"
          className={`nav ${navOpen ? "nav-open" : ""}`}
          aria-label="Основная навигация"
          onClick={() => setNavOpen(false)}
        >
          <NavLink to="/" className="nav-link" end>
            Главная
          </NavLink>
          {nav}
        </nav>
        <PersonaSwitcher />
      </header>

      <Notice tone="demo">{messages.app.demoBanner}</Notice>

      <main id="main" className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<BuyerCatalog />} />
          <Route path="/basket" element={<BuyerBasket />} />
          <Route path="/lists" element={<BuyerLists />} />
          <Route path="/procurement" element={<BuyerProcurement />} />
          <Route path="/procurement/:id" element={<BuyerProcurementDetail />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/supplier" element={<SupplierCockpit />} />
          <Route path="/operator" element={<OperatorCockpit />} />
          <Route path="/operator/audit" element={<AuditPage />} />
          <Route
            path="*"
            element={<Notice tone="warn">Страница не найдена (демо).</Notice>}
          />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>
          HoReCa Marketplace — приватный P0-прототип. Синтетические данные. Не для
          продакшена.
        </p>
      </footer>
    </div>
  );
}
