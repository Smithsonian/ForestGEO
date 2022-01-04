import { render } from 'react-dom';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import Admin from './routes/admin';
import DataEntry from './routes/data-entry';
import DataReports from './routes/data-reports';
import FieldForms from './routes/field-forms';
import FormConfig from './routes/form-config';

const rootElement = document.getElementById('root');
render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />}>
        <Route path="admin" element={<Admin />} />
        <Route path="data-entry" element={<DataEntry />} />
        <Route path="data-reports" element={<DataReports />} />
        <Route path="field-forms" element={<FieldForms />} />
        <Route path="form-config" element={<FormConfig />} />
      </Route>
    </Routes>
  </HashRouter>,
  rootElement
);
