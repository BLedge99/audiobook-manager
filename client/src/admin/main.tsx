/**
 * The admin panel's entry point.
 *
 * A mount, and nothing else. The screens live in `./app.tsx` so they can be
 * rendered in a test.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { AdminLogin } from "./app";
import "./style.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><AdminLogin /></React.StrictMode>);
