import {
    Switch,
    Route
  } from "react-router-dom";

import { About } from './about';
import { Home } from './home';

export const Main = () => (
    <main>
        <Switch>
          <Route strict={false} exact path="/">
            <Home />
          </Route>
          <Route path="/about">
            <About />
          </Route>
        </Switch>
    </main>
);

Main.defaultName = 'Main';