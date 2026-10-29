import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { Id, MapGraph, Page } from "@shared/types";
import { api } from "./api";
import { keys } from "./queries";

function addPage(client: ReturnType<typeof useQueryClient>, page: Page) {
  client.setQueryData<Page[]>(keys.pages, (old) => (old && !old.some((p) => p.id === page.id) ? [...old, page] : old));
  client.setQueryData<MapGraph>(keys.map, (old) =>
    old && !old.pages.some((p) => p.id === page.id) ? { ...old, pages: [...old.pages, page] } : old,
  );
}

/** Create a page and open it. */
export function useCreatePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (body: { parentId?: Id | null; title?: string }) => api.createPage(body),
    onSuccess: (page) => {
      addPage(client, page);
      navigate(`/p/${page.id}`, { state: { fresh: true } });
    },
  });
}

/** Rename, re-icon or move a page, updating every cache straight away. */
export function useUpdatePage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<Page, "title" | "icon" | "parentId">>) => api.updatePage(id, patch),
    onMutate: (patch) => {
      const apply = (p: Page) => (p.id === id ? { ...p, ...patch } : p);
      client.setQueryData<Page[]>(keys.pages, (old) => old?.map(apply));
      client.setQueryData<MapGraph>(keys.map, (old) => (old ? { ...old, pages: old.pages.map(apply) } : old));
      client.setQueryData<Page>(keys.page(id), (old) => (old ? { ...old, ...patch } : old));
    },
    onSuccess: (page) => {
      const apply = (p: Page) => (p.id === id ? { ...p, ...page } : p);
      client.setQueryData<Page[]>(keys.pages, (old) => old?.map(apply));
      client.setQueryData<MapGraph>(keys.map, (old) => (old ? { ...old, pages: old.pages.map(apply) } : old));
    },
  });
}

export function useDeletePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => api.deletePage(id),
    onSuccess: (_, id) => {
      client.setQueryData<Page[]>(keys.pages, (old) => old?.filter((p) => p.id !== id));
      client.setQueryData<MapGraph>(keys.map, (old) =>
        old ? { ...old, pages: old.pages.filter((p) => p.id !== id) } : old,
      );
      client.removeQueries({ queryKey: keys.page(id) });
    },
  });
}
