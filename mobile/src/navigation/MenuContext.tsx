import { createContext, useContext } from "react";

export type MenuContextValue = {
  openMenu: () => void;
};

const MenuContext = createContext<MenuContextValue>({
  openMenu: () => {},
});

export const MenuProvider = MenuContext.Provider;

export function useMenu() {
  return useContext(MenuContext);
}
