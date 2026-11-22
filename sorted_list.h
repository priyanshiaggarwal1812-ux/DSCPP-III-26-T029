/* Sorted doubly linked list written in C.
   Keys are prices in cents (ascending order); values are pointers.
   Mandatory C data structure for price levels in the order book. */
#ifndef TX_SORTED_LIST_H
#define TX_SORTED_LIST_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SortedList SortedList;
typedef void (*slist_free_fn)(void *value);

SortedList* slist_create(void);
void        slist_destroy(SortedList *l, slist_free_fn free_value);
size_t      slist_size(const SortedList *l);

/* 1 = added, 0 = value replaced, -1 = out of memory */
int         slist_insert(SortedList *l, long long key, void *value);
void*       slist_find(const SortedList *l, long long key);
void*       slist_erase(SortedList *l, long long key);

void*       slist_min(const SortedList *l, long long *key_out); /* smallest key (best ask) */
void*       slist_max(const SortedList *l, long long *key_out); /* largest key (best bid) */
void*       slist_next(const SortedList *l, long long key, long long *key_out); /* smallest key > key */
void*       slist_prev(const SortedList *l, long long key, long long *key_out); /* largest key < key */

/* Self-check for tests: returns 1 if valid, -1 if ordering or link is broken */
int         slist_check(const SortedList *l);

#ifdef __cplusplus
}
#endif

#endif /* TX_SORTED_LIST_H */
