/* Doubly linked list written in C. Used as the FIFO queue of orders at one price (time priority). */
#ifndef TX_DLIST_H
#define TX_DLIST_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct DNode { void *data; struct DNode *prev, *next; } DNode;
typedef struct DList { DNode *head, *tail; size_t size; } DList;

DList* dlist_create(void);
void   dlist_destroy(DList *l);                 /* frees the nodes only, never the data */
DNode* dlist_push_back(DList *l, void *data);   /* returns the node so it can be removed in O(1) */
void*  dlist_pop_front(DList *l);               /* returns data, or NULL when empty */
void*  dlist_front(const DList *l);
void   dlist_remove(DList *l, DNode *n);        /* unlink a known node, O(1) */
size_t dlist_size(const DList *l);

#ifdef __cplusplus
}
#endif
#endif
