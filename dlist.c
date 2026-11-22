#include "dlist.h"
#include <stdlib.h>

DList* dlist_create(void) {
    DList *l = (DList*)calloc(1, sizeof(DList));
    return l;
}

void dlist_destroy(DList *l) {
    if (!l) return;
    DNode *n = l->head;
    while (n) { DNode *next = n->next; free(n); n = next; }
    free(l);
}

DNode* dlist_push_back(DList *l, void *data) {
    DNode *n = (DNode*)malloc(sizeof(DNode));
    if (!n) return NULL;
    n->data = data; n->next = NULL; n->prev = l->tail;
    if (l->tail) l->tail->next = n; else l->head = n;
    l->tail = n;
    l->size++;
    return n;
}

void dlist_remove(DList *l, DNode *n) {
    if (n->prev) n->prev->next = n->next; else l->head = n->next;
    if (n->next) n->next->prev = n->prev; else l->tail = n->prev;
    free(n);
    l->size--;
}

void* dlist_pop_front(DList *l) {
    if (!l->head) return NULL;
    void *d = l->head->data;
    dlist_remove(l, l->head);
    return d;
}

void* dlist_front(const DList *l) { return l->head ? l->head->data : NULL; }
size_t dlist_size(const DList *l) { return l->size; }
