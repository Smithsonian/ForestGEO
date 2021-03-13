import {
    Switch,
    Route
  } from "react-router-dom";

import { About } from './about';
import { Home } from './home';
import { New } from './new';

export const Main = () => (
    <main>
        <Switch>
          <Route strict={false} exact path="/">
            <Home />
          </Route>
          <Route path="/about">
            <About />
          </Route>
          <Route path="/new">
            <New />
          </Route>
        </Switch>
    </main>
);

Main.defaultName = 'Main';