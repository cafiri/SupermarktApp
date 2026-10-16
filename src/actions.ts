import { createContext, useContext } from 'react';
import type { Offer } from '../shared/types';

/** Aktionen, die jede Angebotszeile braucht (Einkaufsliste), ohne sie durch alle Ansichten zu reichen */
export interface ListActions {
  toggleListOffer: (o: Offer) => void;
  isOnList: (id: number) => boolean;
}

export const ListContext = createContext<ListActions | null>(null);
export const useListActions = () => useContext(ListContext);
