import { Outlet, Link } from 'react-router-dom';

export default function App() {
  return (
    <div>
      <h1>ForestGEO App</h1>
      <nav
        style={{
          borderBottom: 'solid 1px',
          paddingBottom: '1rem',
        }}
      >
        <Link to="/form-config">Form Configuration</Link> |{' '}
        <Link to="/data-entry">Data Entry</Link> |{' '}
        <Link to="/data-reports">Data Reports</Link> |{' '}
        <Link to="/field-forms">Field Forms</Link> |{' '}
        <Link to="/admin">Admin</Link>
      </nav>
      <Outlet />
    </div>
  );
}
